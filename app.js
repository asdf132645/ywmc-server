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
app.get('/cbc-results', async (req, res) => {
    const { smp_no } = req.query;

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
        connection = await connectToDatabase();
        if (!connection) {
            console.error('데이터베이스 연결에 실패했습니다.');
            return res.status(500).json({ error: '데이터베이스 연결에 실패했습니다.' });
        }

        // EUC-KR 인코딩을 설정
        await connection.query('SET NAMES \'EUC-KR\'');

        const result = await connection.query(query, [smp_no]);

        // EUC-KR로 인코딩된 데이터를 UTF-8로 변환
        const utf8Result = result.map(row => {
            return {
                ...row,
                text_rslt: iconv.decode(Buffer.from(row.text_rslt, 'binary'), 'EUC-KR'),
                // 필요한 다른 필드도 변환할 수 있습니다.
            };
        });

        // 응답의 Content-Type을 UTF-8로 설정
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({ data: utf8Result });
    } catch (err) {
        console.error('쿼리 실행 중 오류 발생:', err);
        return res.status(500).json({ error: '쿼리 실행 중 오류 발생: ' + err.message });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});


// 이미지 저장 엔드포인트
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
                spo..scacceptaqnce a 
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
app.put('/save-uimd-result', async (req, res) => {
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



// 서버 시작
app.listen(PORT, () => {
    console.log(`Sybase Express 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
