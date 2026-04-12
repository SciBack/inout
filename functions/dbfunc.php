<?php
	function getroles($conn){
		$sql = "SELECT * FROM roles";
		$result = mysqli_query($conn, $sql);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getspecificrole($conn, $id){
		$stmt = mysqli_prepare($conn, "SELECT * FROM roles WHERE id = ?");
		mysqli_stmt_bind_param($stmt, 'i', $id);
		mysqli_stmt_execute($stmt);
		$result = mysqli_stmt_get_result($stmt);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getusers($conn){
		$sql = "SELECT * FROM users";
		$result = mysqli_query($conn, $sql);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getspecificuser($conn, $id){
		$stmt = mysqli_prepare($conn, "SELECT * FROM users WHERE id = ?");
		mysqli_stmt_bind_param($stmt, 'i', $id);
		mysqli_stmt_execute($stmt);
		$result = mysqli_stmt_get_result($stmt);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getData($conn, $table){
		$table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
		$sql = "SELECT * FROM `$table`";
		$result = mysqli_query($conn, $sql);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getDataById(mysqli $conn, string $table, int $id){
		$sql = "SELECT * FROM `$table` WHERE id = ?";
		$stmt = mysqli_prepare($conn, $sql);
		if(!$stmt){
			echo "Can't prepare statement " . mysqli_error($conn);
			exit;
		}
		mysqli_stmt_bind_param($stmt, 'i', $id);
		mysqli_stmt_execute($stmt);
		$result = mysqli_stmt_get_result($stmt);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function getDataBySpesificId(mysqli $conn, string $table, string $var, $var2){
		$column = preg_replace('/[^a-zA-Z0-9_]/', '', $var);
		$sql = "SELECT * FROM `$table` WHERE `$column` = ?";
		$stmt = mysqli_prepare($conn, $sql);
		if(!$stmt){
			echo "Can't prepare statement " . mysqli_error($conn);
			exit;
		}
		$type = is_int($var2) ? 'i' : 's';
		mysqli_stmt_bind_param($stmt, $type, $var2);
		mysqli_stmt_execute($stmt);
		$result = mysqli_stmt_get_result($stmt);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function setupStats($conn){
		$vars = ['cname', 'libtime', 'noname', 'banner', 'activedash'];
		$values = [];
		$stmt = mysqli_prepare($conn, "SELECT value FROM `setup` WHERE var = ?");
		foreach ($vars as $var) {
			mysqli_stmt_bind_param($stmt, 's', $var);
			mysqli_stmt_execute($stmt);
			$result = mysqli_stmt_get_result($stmt);
			$row = $result ? mysqli_fetch_row($result) : [null];
			$values[] = $row[0] ?? null;
		}
		return $values;
	}

	function getNews($conn){
		$sql = "SELECT * FROM news ORDER BY id DESC LIMIT 5";
		$result = mysqli_query($conn, $sql);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function checknews($conn, $loc){
		$stmt = mysqli_prepare($conn, "SELECT * FROM news WHERE loc = ? AND status = 'Yes' ORDER BY id DESC");
		mysqli_stmt_bind_param($stmt, 's', $loc);
		mysqli_stmt_execute($stmt);
		$result = mysqli_stmt_get_result($stmt);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return mysqli_fetch_array($result);
	}

	function getBackupData($conn, $table){
		$table = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
		$sql = "SELECT * FROM `$table` ORDER BY id DESC LIMIT 10";
		$result = mysqli_query($conn, $sql);
		if(!$result){
			echo "Can't retrieve data " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	function logthis($conn, $id, $date, $time, $usertype, $userid, $action){
		$stmt = mysqli_prepare($conn, "INSERT INTO `log` (`id`, `date`, `time`, `usertype`, `userid`, `action`) VALUES (?, ?, ?, ?, ?, ?)");
		mysqli_stmt_bind_param($stmt, 'isssss', $id, $date, $time, $usertype, $userid, $action);
		$result = mysqli_stmt_execute($stmt);
		if(!$result){
			echo "Can't insert log: " . mysqli_error($conn);
			exit;
		}
		return $result;
	}

	/**
	 * Fetch an array of cover image URLs for the most recent items in Koha.
	 *
	 * @param mysqli  $koha    Connection to the Koha database.
	 * @param string  $baseUrl Base OPAC URL. Trailing slash will be trimmed.
	 * @param int     $limit   Number of covers to return.
	 * @return array
	 */
	function getNewArrivalsCovers(mysqli $koha, string $baseUrl, int $limit = 8): array {
		$covers = [];
		$limit = max(1, (int)$limit);
		$sql = "SELECT DISTINCT biblionumber FROM items ORDER BY dateaccessioned DESC LIMIT $limit";
		if ($result = mysqli_query($koha, $sql)) {
			while ($row = mysqli_fetch_assoc($result)) {
				$covers[] = rtrim($baseUrl, '/') . '/cgi-bin/koha/opac-image.pl?thumbnail=1&biblionumber=' . urlencode($row['biblionumber']);
			}
		}
		return $covers;
	}
