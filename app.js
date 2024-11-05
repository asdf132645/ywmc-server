// express-server/app.js
const express = require('express');
const odbc = require('odbc');
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
    WHERE num.slip = 'H1'
      AND num.smp_no = ?
  `;

    let connection;
    try {
        connection = await connectToDatabase();
        if (!connection) {
            console.error('데이터베이스 연결에 실패했습니다.');
            return res.status(500).json({ error: '데이터베이스 연결에 실패했습니다.' });
        }
        const result = await connection.query(query, [smp_no]);
        res.json({ data: result });
    } catch (err) {
        console.error('쿼리 실행 중 오류 발생:', err);
        return res.status(500).json({ error: '쿼리 실행 중 오류 발생: ' + err.message });
    } finally {
        if (connection) {
            await connection.close();
        }
    }
});


// UIMD 결과 저장 엔드포인트
app.post('/save-uimd-result', async (req, res) => {
    const {
        ttext_rslt, tnumeric_rslt, tequp_cd, tequp_typ, tequp_rslt,
        tsmp_no, texam_cd, tspc, trslt_srno
    } = req.body;

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

        // `exam_stus`가 F가 아닌 경우 업데이트 진행
        const updateNumericSQL = `
      UPDATE spo..scnumeric
      SET text_rslt = ?,
          numeric_rslt = ?,
          rslt_stus = 'T',
          equp_cd = ?,
          equp_typ = ?,
          equp_rslt = ?,
          lst_edtr = ?,
          lst_edt_dt = rtrim(convert(char, getdate(), 112)) 
                       || substring(convert(char, getdate(), 108), 1, 2) 
                       || substring(convert(char, getdate(), 108), 4, 2)
      FROM spo..scnumeric num
      JOIN spo..scacceptance acc ON num.exam_ymd_unit = acc.exam_ymd_unit 
                                 AND num.slip = acc.slip 
                                 AND num.wrk_no = acc.wrk_no
      WHERE num.smp_no = ?
        AND num.exam_cd = ?
        AND num.spc = ?
    `;

        await connection.query(updateNumericSQL, [ttext_rslt, tnumeric_rslt, tequp_cd, tequp_typ, tequp_rslt, tequp_cd, tsmp_no, texam_cd, tspc]);

        const updateAcceptanceSQL = `
        UPDATE spo..scacceptance
        SET rslt_srno = ?,
            equp_cd = ?,
            equp_typ = ?,
            exam_stus = 'T'
        WHERE smp_no = ?
      `;

        await connection.query(updateAcceptanceSQL, [trslt_srno, tequp_cd, tequp_typ, tsmp_no]);

        res.json({ data: 'Update 성공' });
        await connection.close();
    } catch (err) {
        return res.status(500).json({ error: '업데이트 중 오류 발생: ' + err.message });
    }
});

app.post('/updateUimdCrcData', async (req, res) => {
    const {
        barcode_num,
        rbc_size,
        rbc_chromicity,
        rbc_anisocytosis,
        rbc_poikilocytosis,
        rbc_polychromasia,
        rbc_rouleaux_formation,
        rbc_inclusion,
        rbc_shape1,
        rbc_shape2,
        rbc_etc,
        wbc_number,
        wbc_toxic_granulation,
        wbc_vacuolation,
        wbc_segmentation,
        wbc_reactive_lymphocyte,
        wbc_abnormal_lymphocyte,
        wbc_other_findings,
        wbc_etc,
        plt_number,
        plt_giant_platelet,
        plt_other_findings,
        plt_etc,
        comment,
        recommendation
    } = req.body;
    //blood_test_results -> 임시테이블명
    const checkBarcodeSQL = `
        SELECT COUNT(*) as count
        FROM blood_test_results
        WHERE barcode_num = ?
    `;

    try {
        const connection = await connectToDatabase();
        const result = await connection.query(checkBarcodeSQL, [barcode_num]);

        if (result[0].count === 0) {
            return res.status(404).json({ error: 'Barcode number not found.' });
        }

        // Update the blood test result
        const updateSQL = `
            UPDATE blood_test_results
            SET rbc_size = ?,
                rbc_chromicity = ?,
                rbc_anisocytosis = ?,
                rbc_poikilocytosis = ?,
                rbc_polychromasia = ?,
                rbc_rouleaux_formation = ?,
                rbc_inclusion = ?,
                rbc_shape1 = ?,
                rbc_shape2 = ?,
                rbc_etc = ?,
                wbc_number = ?,
                wbc_toxic_granulation = ?,
                wbc_vacuolation = ?,
                wbc_segmentation = ?,
                wbc_reactive_lymphocyte = ?,
                wbc_abnormal_lymphocyte = ?,
                wbc_other_findings = ?,
                wbc_etc = ?,
                plt_number = ?,
                plt_giant_platelet = ?,
                plt_other_findings = ?,
                plt_etc = ?,
                comment = ?,
                recommendation = ?
            WHERE barcode_num = ?
        `;

        await connection.query(updateSQL, [
            rbc_size,
            rbc_chromicity,
            rbc_anisocytosis,
            rbc_poikilocytosis,
            rbc_polychromasia,
            rbc_rouleaux_formation,
            rbc_inclusion,
            rbc_shape1,
            rbc_shape2,
            rbc_etc,
            wbc_number,
            wbc_toxic_granulation,
            wbc_vacuolation,
            wbc_segmentation,
            wbc_reactive_lymphocyte,
            wbc_abnormal_lymphocyte,
            wbc_other_findings,
            wbc_etc,
            plt_number,
            plt_giant_platelet,
            plt_other_findings,
            plt_etc,
            comment,
            recommendation,
            barcode_num
        ]);

        res.json({ data: 'Update successful' });
        await connection.close();
    } catch (err) {
        return res.status(500).json({ error: 'Error during update: ' + err.message });
    }
});



// 서버 시작
app.listen(PORT, () => {
    console.log(`Sybase Express 서버가 포트 ${PORT}에서 실행 중입니다.`);
});
