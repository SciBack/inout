<?php
$loc  = $_SESSION['loc'] ?? '';
$date = date('Y-m-d');

// Un solo query para los 4 contadores del dashboard
$stmt = mysqli_prepare($conn,
    "SELECT
        COUNT(sl)                                        AS total_visit,
        SUM(gender = 'M' AND status = 'IN')              AS total_male,
        SUM(gender = 'F' AND status = 'IN')              AS total_female,
        SUM(status = 'IN')                               AS total_in
     FROM `inout`
     WHERE date = ? AND loc = ?"
);
mysqli_stmt_bind_param($stmt, 'ss', $date, $loc);
mysqli_stmt_execute($stmt);
$statsRow = mysqli_fetch_assoc(mysqli_stmt_get_result($stmt));

$visit  = [$statsRow['total_visit']  ?? 0];
$male   = [$statsRow['total_male']   ?? 0];
$female = [$statsRow['total_female'] ?? 0];
$tin    = [$statsRow['total_in']     ?? 0];

// Distribución por categoría — ORDER BY COUNT DESC en lugar de RAND()
$stmt2 = mysqli_prepare($conn,
    "SELECT cc, COUNT(sl) AS cnt
     FROM `inout`
     WHERE date = ? AND loc = ?
     GROUP BY cc
     ORDER BY cnt DESC
     LIMIT 3"
);
mysqli_stmt_bind_param($stmt2, 'ss', $date, $loc);
mysqli_stmt_execute($stmt2);
$extraCount = mysqli_stmt_get_result($stmt2);
