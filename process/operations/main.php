<?php
session_start();
$loc = $_SESSION['loc'] ?? '';
include './functions/dbconn.php';
include './functions/general.php';

// Limpia registros temporales antiguos
$sql = "DELETE FROM `tmp2` WHERE `time` < DATE_SUB(NOW(), INTERVAL '00:10' MINUTE_SECOND)";
mysqli_query($conn, $sql);

// Inicialización de variables globales usadas en dash.php
$e_name = $d_status = $e_img = $msg = $date = $time1 = $usn = $usn_koha = '';
$otime = [];

if (isset($_GET['id']) && !empty($_GET['id'])) {
    $usn_raw = strtoupper(trim($_GET['id']));
    $usn     = sanitize($conn, $usn_raw);

    $date = date('Y-m-d');
    $time = date('H:i:s');

    // Consulta de usuario en Koha — prepared statement, fetch_assoc
    $stmt = mysqli_prepare($koha,
        "SELECT firstname, surname, CONCAT(title,' ',firstname,' ',surname) AS fullname,
                borrowernumber, sex, categorycode, branchcode,
                sort1, sort2, mobile, email, title,
                dateofbirth, dateexpiry, borrowernotes
         FROM borrowers WHERE cardnumber = ?"
    );
    mysqli_stmt_bind_param($stmt, 's', $usn_raw);
    mysqli_stmt_execute($stmt);
    $result = mysqli_stmt_get_result($stmt);
    $data1  = ($result && mysqli_num_rows($result)) ? mysqli_fetch_assoc($result) : null;

    $isExpired = false;
    if ($data1 && !empty($data1['dateexpiry']) && strtotime($data1['dateexpiry']) <= strtotime($date)) {
        $isExpired = true;
    }

    // Imagen de usuario
    $e_img = null;
    if ($data1 && !empty($data1['borrowernumber'])) {
        $stmt2 = mysqli_prepare($koha, "SELECT imagefile FROM patronimage WHERE borrowernumber = ?");
        mysqli_stmt_bind_param($stmt2, 'i', $data1['borrowernumber']);
        mysqli_stmt_execute($stmt2);
        $res2  = mysqli_stmt_get_result($stmt2);
        $data2 = ($res2 && mysqli_num_rows($res2)) ? mysqli_fetch_row($res2) : null;
        $e_img = $data2[0] ?? null;
    }

    // Categoría y sucursal del usuario
    $catDesc = $branchDesc = '';
    if ($data1 && !empty($data1['categorycode'])) {
        $stmt3 = mysqli_prepare($koha, "SELECT description FROM categories WHERE categorycode = ?");
        mysqli_stmt_bind_param($stmt3, 's', $data1['categorycode']);
        mysqli_stmt_execute($stmt3);
        $res3    = mysqli_stmt_get_result($stmt3);
        $data3   = ($res3 && mysqli_num_rows($res3)) ? mysqli_fetch_row($res3) : null;
        $catDesc = $data3[0] ?? '';
    }
    if ($data1 && !empty($data1['branchcode'])) {
        $stmt4 = mysqli_prepare($koha, "SELECT branchname FROM branches WHERE branchcode = ?");
        mysqli_stmt_bind_param($stmt4, 's', $data1['branchcode']);
        mysqli_stmt_execute($stmt4);
        $res4      = mysqli_stmt_get_result($stmt4);
        $data4     = ($res4 && mysqli_num_rows($res4)) ? mysqli_fetch_row($res4) : null;
        $branchDesc = $data4[0] ?? '';
    }

    // Helper: insertar registro tmp2
    $insertTmp2 = function() use ($conn, $usn) {
        $s = mysqli_prepare($conn, "INSERT INTO `tmp2` (`usn`, `time`) VALUES (?, CURRENT_TIMESTAMP)");
        mysqli_stmt_bind_param($s, 's', $usn);
        mysqli_stmt_execute($s);
    };

    // --- Lógica de entrada y salida ---
    if ($data1 && !$isExpired) {
        // ¿Está el usuario IN hoy?
        $stmtIn = mysqli_prepare($conn,
            "SELECT * FROM `inout` WHERE `cardnumber` = ? AND `date` = ? AND `status` = 'IN'"
        );
        mysqli_stmt_bind_param($stmtIn, 'ss', $usn, $date);
        mysqli_stmt_execute($stmtIn);
        $resIn  = mysqli_stmt_get_result($stmtIn);
        $exit   = ($resIn && mysqli_num_rows($resIn)) ? mysqli_fetch_assoc($resIn) : null;

        // ¿Está en tmp2? (evita dobles escaneos rápidos)
        $stmtTmp = mysqli_prepare($conn, "SELECT `usn` FROM tmp2 WHERE `usn` = ?");
        mysqli_stmt_bind_param($stmtTmp, 's', $usn);
        mysqli_stmt_execute($stmtTmp);
        $resTmp = mysqli_stmt_get_result($stmtTmp);
        $inTmp  = ($resTmp && mysqli_num_rows($resTmp)) ? true : false;

        if ($exit) {
            if (!$inTmp) {
                if ($exit['loc'] !== ($_SESSION['locname'] ?? '')) {
                    // Cambio de local: cierra anterior, abre nuevo IN
                    $sl_cierre = (int)$exit['sl'];
                    $stmtUpd = mysqli_prepare($conn,
                        "UPDATE `inout` SET `exit` = ?, `status` = 'OUT' WHERE `sl` = ?"
                    );
                    mysqli_stmt_bind_param($stmtUpd, 'si', $time, $sl_cierre);
                    mysqli_stmt_execute($stmtUpd);

                    $libtime = $_SESSION['libtime'] ?? '00:00:00';
                    $stmtIns = mysqli_prepare($conn,
                        "INSERT INTO `inout`
                         (`cardnumber`, `name`, `gender`, `date`, `entry`, `exit`, `status`, `loc`, `cc`, `branch`, `sort1`, `sort2`, `email`, `mob`)
                         VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)"
                    );
                    mysqli_stmt_bind_param($stmtIns, 'sssssssssssss',
                        $usn, $data1['fullname'], $data1['sex'],
                        $date, $time, $libtime,
                        $loc, $catDesc, $branchDesc,
                        $data1['sort1'], $data1['sort2'],
                        $data1['email'], $data1['mobile']
                    );
                    mysqli_stmt_execute($stmtIns);
                    $e_name  = $data1['fullname'];
                    $d_status = "IN";
                    $msg     = "1";
                    $time1   = date('g:i A', strtotime($time));
                    $insertTmp2();
                } else {
                    // Salida normal
                    $sl_salida = (int)$exit['sl'];
                    $stmtOut = mysqli_prepare($conn,
                        "UPDATE `inout` SET `exit` = ?, `status` = 'OUT' WHERE `sl` = ?"
                    );
                    mysqli_stmt_bind_param($stmtOut, 'si', $time, $sl_salida);
                    mysqli_stmt_execute($stmtOut);

                    $stmtDur = mysqli_prepare($conn,
                        "SELECT SUBTIME(`exit`, `entry`) FROM `inout` WHERE `sl` = ?"
                    );
                    mysqli_stmt_bind_param($stmtDur, 'i', $sl_salida);
                    mysqli_stmt_execute($stmtDur);
                    $resDur = mysqli_stmt_get_result($stmtDur);
                    $otime  = ($resDur && mysqli_num_rows($resDur)) ? mysqli_fetch_row($resDur) : [];

                    $e_name  = $data1['fullname'];
                    $d_status = "OUT";
                    $msg     = "4";
                    $time1   = date('g:i A', strtotime($time));
                    $insertTmp2();
                }
            } else {
                // Escaneo duplicado reciente
                $msg  = "2";
                $e_name = $d_status = $e_img = $date = null;
                $time1 = "-";
            }
        } else {
            if ($inTmp) {
                // Salida reciente duplicada
                $msg  = "5";
                $e_name = $d_status = $e_img = $date = null;
                $time1 = "-";
            } else {
                // Nueva entrada IN
                $libtime = $_SESSION['libtime'] ?? '00:00:00';
                $stmtNew = mysqli_prepare($conn,
                    "INSERT INTO `inout`
                     (`cardnumber`, `name`, `gender`, `date`, `entry`, `exit`, `status`, `loc`, `cc`, `branch`, `sort1`, `sort2`, `email`, `mob`)
                     VALUES (?, ?, ?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?)"
                );
                mysqli_stmt_bind_param($stmtNew, 'sssssssssssss',
                    $usn, $data1['fullname'], $data1['sex'],
                    $date, $time, $libtime,
                    $loc, $catDesc, $branchDesc,
                    $data1['sort1'], $data1['sort2'],
                    $data1['email'], $data1['mobile']
                );
                mysqli_stmt_execute($stmtNew);
                $e_name  = $data1['fullname'];
                $d_status = "IN";
                $msg     = "1";
                $time1   = date('g:i A', strtotime($time));
                $insertTmp2();
            }
        }
    } elseif ($data1 && $isExpired) {
        $msg  = "3";
        $e_name = $d_status = $e_img = $date = null;
        $time1 = "-";
    } else {
        $msg  = "0";
        $e_name = $d_status = $e_img = $date = null;
        $time1 = "-";
    }
} else {
    $e_name = $d_status = $e_img = $msg = $date = null;
    $time1 = "-";
}
