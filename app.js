// express-server/app.js
const express = require('express');
const odbc = require('odbc');
const iconv = require('iconv-lite');
const bodyParser = require('body-parser');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// ODBC 연결 문자열 설정
// const connectionString = "Driver={Adaptive Server Enterprise};Server=128.9.2.30;uid=Llmlis;pwd=lm1588##;Port=6000;"; 개발 서버
const connectionString = "Driver={Adaptive Server Enterprise};Server=128.9.1.21;uid=Llmlis;pwd=lm1588##;Port=4100;";
// const connectionString = "DSN=Sybase ASE ODBC Driver;UID=Llmlis;PWD=lm1588##;Port=4100;";


app.use(bodyParser.json({ limit: '10mb' })); // 예시로 10MB로 설정


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

    const examCodes = [
        '8HGCBC-1',
        '8HGCBC-2',
        '8HGCBC-3',
        '8HGCBC-4',
        '8HGCBC-5'
    ];

    // examCodes 배열을 SQL 쿼리에서 사용할 수 있는 문자열로 변환
    const examCodesString = examCodes.map(code => `'${code}'`).join(', ');

    const query = `
SELECT num.exam_ymd_unit, num.slip, num.wrk_no, num.exam_cd, num.spc, num.pt_no,
           num.rslt_typ, num.text_rslt, num.numeric_rslt, num.unit, num.rslt_stus,
           num.ref_stus, pt.pt_nm, acc.sex, acc.age
    FROM spo..scnumeric num
    JOIN spo..scacceptance acc ON acc.smp_no = num.smp_no
    JOIN spo..v_osmp_patient pt ON acc.pt_no = pt.pt_no
    WHERE num.smp_no = ?
UNION ALL
 SELECT num.exam_ymd_unit, num.slip, num.wrk_no, num.exam_cd, num.spc, num.pt_no,
           num.rslt_typ, num.text_rslt, num.numeric_rslt, num.unit, num.rslt_stus,
           num.ref_stus, pt.pt_nm, acc.sex, acc.age
    FROM spo..scnumeric num
    JOIN spo..scacceptance acc ON acc.smp_no = num.smp_no
    JOIN spo..v_osmp_patient pt ON pt.pt_no = num.pt_no
    WHERE num.pt_no = (
        SELECT MAX(pt_no)
        FROM spo..scacceptance
        WHERE smp_no = ?
    )
    AND num.exam_ymd_unit <= CONVERT(CHAR, GETDATE(), 112)
    AND num.slip = 'H1'
    AND num.p_exam_cd IN (${examCodesString})
    AND num.lst_edt_dt = (
        SELECT MAX(x.lst_edt_dt)
        FROM spo..scnumeric x
        WHERE x.pt_no = num.pt_no
          AND x.slip = 'H1'
          AND x.p_exam_cd IN (${examCodesString})
          AND x.spc = num.spc
          AND x.exam_ymd_unit <= CONVERT(CHAR, GETDATE(), 112)
    )
    AND num.rslt_stus = 'F'
    `;

    let connection;

    try {
        // Sybase 데이터베이스 연결
        connection = await connectToDatabase();

        // 쿼리 실행
        const result = await connection.query(query, [smp_no, smp_no]);
        console.log('smp_no', smp_no);

        // 데이터 변환 (EUC-KR -> UTF-8)
        const utf8Result = result.map(row => ({
            ...row,
            text_rslt: row.text_rslt ? iconv.decode(Buffer.from(row.text_rslt, 'binary'), 'EUC-KR') : null,
            pt_nm: row.pt_nm ? iconv.decode(Buffer.from(row.pt_nm, 'binary'), 'EUC-KR') : null,
        }));

        // UTF-8 데이터 응답
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json({ data: utf8Result });
        console.log('result', utf8Result);

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





// 이미지 불러오는 엔드포인트 pbs 용 저장 시 사용
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
    const { size, image_rslt, rslt_stus, exam_ymd_unit, slip, wrk_no, exam_cd, spc } = req.body;

    // 필수 필드 체크
    if (!exam_ymd_unit || !slip || !wrk_no || !exam_cd || !spc) {
        return res.status(400).send('Missing required fields');
    }

    let connection;
    try {
        // 데이터베이스 연결
        connection = await connectToDatabase();

        // HEX 문자열을 바이너리 데이터로 변환 (Buffer로 변환)
        let binaryImageResult = null;
        if (image_rslt) {
            try {
                // image_rslt는 이미 HEX 문자열이므로, Buffer로 변환하여 바이너리 데이터로 처리
                binaryImageResult = Buffer.from(image_rslt, 'hex');
            } catch (err) {
                console.error('Invalid HEX string:', image_rslt);
                return res.status(400).send('Invalid image data format');
            }
        }

        // SQL UPDATE 쿼리
        const updateQuery = `
            UPDATE spo..scimage
            SET size = ?, 
                image_rslt = ?, 
                rslt_stus = ?
            WHERE exam_ymd_unit = ? 
              AND slip = ? 
              AND wrk_no = ? 
              AND exam_cd = ? 
              AND spc = ?
        `;

        console.log('Update Query Parameters:', {
            size, binaryImageResult, rslt_stus, exam_ymd_unit, slip, wrk_no, exam_cd, spc
        });

        // 쿼리 실행
        await connection.query(updateQuery, [
            size,
            binaryImageResult,  // 바이너리 데이터
            rslt_stus,
            exam_ymd_unit,
            slip,
            wrk_no,
            exam_cd,
            spc,
        ]);

        // 성공 메시지 반환
        res.send('Update successful');
    } catch (err) {
        console.error('Database Error:', err);
        res.status(500).send('Database error');
    } finally {
        // 연결 종료
        if (connection) {
            await connection.close();
        }
    }
});





// CBC 일 경우 저장하는 부분
app.post('/save-comment', async (req, res) => {
    const { text_rslt, tsmp_no } = req.body;

    if (!text_rslt || !tsmp_no) {
        return res.status(400).json({ error: 'text_rslt와 tsmp_no는 필수입니다.' });
    }

    // SQL 쿼리
    const checkStatusSQL = `
        SELECT exam_stus
        FROM spo..scacceptance
        WHERE smp_no = ?
    `;

    const updateCommentSQL = `
        UPDATE spo..scnumeric
        SET text_rslt = ?
        WHERE smp_no = ?
          AND exam_cd = '8HDIGI_R_WR'
    `;

    let connection;
    try {
        connection = await connectToDatabase(); // 데이터베이스 연결
        await connection.beginTransaction(); // 트랜잭션 시작

        // `exam_stus` 상태 확인
        const result = await connection.query(checkStatusSQL, [tsmp_no]);
        const examStatus = result[0]?.exam_stus;

        console.log('examStatus:', examStatus);

        if (examStatus === 'F') {
            return res.status(400).json({ error: 'exam_stus가 F인 경우 저장할 수 없습니다.' });
        }

        // 코멘트 업데이트
        console.log('updateCommentSQL:', updateCommentSQL);
        await connection.query(updateCommentSQL, [text_rslt, tsmp_no]);

        await connection.commit(); // 트랜잭션 커밋
        res.json({ code: 200, message: '코멘트가 성공적으로 저장되었습니다.' });
    } catch (err) {
        if (connection) {
            await connection.rollback(); // 오류 발생 시 트랜잭션 롤백
        }
        console.error('쿼리 실행 중 오류:', err.message);
        res.status(500).json({ error: '업데이트 중 오류 발생: ' + err.message });
    } finally {
        // 연결 종료
        if (connection) {
            try {
                await connection.close();
                console.log('Sybase 연결 종료');
            } catch (closeErr) {
                console.error('연결 종료 중 오류:', closeErr.message);
            }
        }
    }
});


// 서버 시작
app.listen(PORT, () => {
    console.log(`Sybase Express 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
