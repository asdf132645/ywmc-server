// express-server/app.js
const express = require('express');
const odbc = require('odbc');
const iconv = require('iconv-lite');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// ODBC 연결 문자열 설정
const connectionString = "Driver={Adaptive Server Enterprise};Server=128.9.2.30;uid=Llmlis;pwd=lm1588##;Port=6000;";
// const connectionString = "DSN=Sybase ASE ODBC Driver;UID=Llmlis;PWD=lm1588##;Port=4100;";


app.use(express.json());
app.use(express.json({ limit: '1000mb' })); // JSON 요청 크기 제한 1GB로 설정
app.use(express.urlencoded({ limit: '1000mb', extended: true })); // URL-encoded 데이터 크기 제한

// 연결 함수
async function connectToDatabase() {
    try {
        const connection = await odbc.connect(connectionString);
        console.log('Sybase 연결 성공');
        return connection;
    } catch (error) {
        console.error('Sybase 연결 실패:', error);
        process.exit(1); // 연결 실패 시 서버 종료
    }
}

// CBC 결과 조회 엔드포인트
// CBC 결과 조회 API
app.get('/cbc-results', async (req, res) => {
    const { smp_no } = req.query;

    if (!smp_no) {
        return res.status(400).json({ error: 'smp_no 파라미터가 필요합니다.' });
    }

    const query = `
    SELECT num.exam_ymd_unit, num.slip, num.wrk_no, num.exam_cd, num.spc, num.pt_no, 
           num.rslt_typ, num.text_rslt, num.numeric_rslt, num.unit, num.rslt_stus, 
           num.ref_stus, pt.pt_nm, acc.sex, acc.age
    FROM spo..scnumeric num
    JOIN spo..scacceptance acc ON acc.smp_no = num.smp_no
    JOIN spo..v_osmp_patient pt ON acc.pt_no = pt.pt_no
    WHERE num.smp_no = ?
    `;

    let connection;

    try {
        // Sybase 데이터베이스 연결
        connection = await connectToDatabase();

        // 쿼리 실행
        const result = await connection.query(query, [smp_no]);

        // 데이터 변환 (EUC-KR -> UTF-8)
        const utf8Result = result.map(row => {
            return {
                ...row,
                text_rslt: row.text_rslt
                    ? iconv.decode(Buffer.from(row.text_rslt, 'binary'), 'EUC-KR')
                    : null,
                pt_nm: row.pt_nm
                    ? iconv.decode(Buffer.from(row.pt_nm, 'binary'), 'EUC-KR')
                    : null,
            };
        });

        // UTF-8 데이터 응답
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({ data: utf8Result });
    } catch (error) {
        console.error('쿼리 실행 중 오류 발생:', error.message);
        res.status(500).json({ error: `쿼리 실행 중 오류: ${error.message}` });
    } finally {
        // 연결 닫기
        if (connection) {
            try {
                await connection.close();
                console.log('Sybase 연결 종료');
            } catch (closeError) {
                console.error('연결 종료 중 오류:', closeError.message);
            }
        }
    }
});


// 이미지 불러오는 엔드포인트
app.get('/cbcImgGet', async (req, res) => {
    const { smp_no } = req.query; // 쿼리 파라미터에서 smp_no 가져오기

    if (!smp_no) {
        return res.status(400).send('smp_no is required');
    }

    let connection;
    try {
        // 데이터베이스 연결
        connection = await connectToDatabase();

        // SQL 쿼리 실행
        const query = `
            SELECT 
                exam_ymd_unit, 
                slip, 
                wrk_no, 
                (SELECT MAX(x.exam_cd) FROM spo..scimage x WHERE x.smp_no = a.smp_no) AS exam_cd, 
                spc 
            FROM 
                spo..scacceptance a 
            WHERE 
                a.smp_no = ?
        `;

        const result = await connection.query(query, [smp_no]);

        // 결과 반환
        res.json(result);
    } catch (err) {
        console.error(err);
        return res.status(500).send('Database error');
    } finally {
        // 연결 종료
        if (connection) {
            await connection.close();
        }
    }
});



// UIMD 결과 저장 엔드포인트
app.post('/save-uimd-result', async (req, res) => {
    const { size, image_rslt, width, height, rslt_stus, exam_ymd_unit, slip, wrk_no, exam_cd, spc } = req.body;

    if (!exam_ymd_unit || !slip || !wrk_no || !exam_cd || !spc) {
        return res.status(400).send('Missing required fields');
    }

    let connection;
    try {
        // 데이터베이스 연결
        connection = await connectToDatabase();

        // SQL UPDATE 쿼리
        const updateQuery = `
            UPDATE spo..scimage
            SET size = ?, 
                image_rslt = ?, 
                width = ?, 
                height = ?, 
                rslt_stus = ?
            WHERE exam_ymd_unit = ? 
              AND slip = ? 
              AND wrk_no = ? 
              AND exam_cd = ? 
              AND spc = ?
        `;
        // await connection.query('SET TEXTSIZE 104857600;');
        console.log('image_rslt', image_rslt);
        console.log('req.body', req.body)
        // 쿼리 실행
        await connection.query(updateQuery, [size, image_rslt, width, height, rslt_stus, exam_ymd_unit, slip, wrk_no, exam_cd, spc]);

        // 성공 메시지 반환
        res.send('Update successful');
    } catch (err) {
        console.error(err);
        res.status(500).send('Database error');
    } finally {
        // 연결 종료
        if (connection) {
            await connection.close();
        }
    }
});


app.post('/save-comment', async (req, res) => {
    const { ttext_rslt, tsmp_no } = req.body;

    // exam_stus가 F인지 확인하는 쿼리
    const checkStatusSQL = `
    SELECT exam_stus
    FROM spo..scacceptance
    WHERE smp_no = ?
  `;

    try {
        const connection = await connectToDatabase();
        const result = await connection.query(checkStatusSQL, [tsmp_no]);

        const examStatus = result[0]?.exam_stus;
        if (examStatus === 'F') {
            return res.status(400).json({ error: 'exam_stus가 F인 경우 저장할 수 없습니다.' });
        }

        // `exam_stus`가 F가 아닌 경우 text_rslt만 업데이트
        const updateTextResultSQL = `
        UPDATE spo..scnumeric
        SET text_rslt = ?
        FROM spo..scnumeric num
        JOIN spo..scacceptance acc ON num.exam_ymd_unit = acc.exam_ymd_unit 
                                   AND num.slip = acc.slip 
                                   AND num.wrk_no = acc.wrk_no
        WHERE num.smp_no = ?
        `;

        await connection.query(updateTextResultSQL, [ttext_rslt, tsmp_no]);

        res.json({ code: 200 });
        await connection.close();
    } catch (err) {
        return res.status(500).json({ error: '업데이트 중 오류 발생: ' + err.message });
    }
});

// 서버 시작
app.listen(PORT, () => {
    console.log(`Sybase Express 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
