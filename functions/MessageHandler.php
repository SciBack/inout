<?php

class MessageHandler {
    private array $timeGreetings = [
        'morning'   => ['¡Buenos días', 'Muy buenos días', 'Saludos matutinos'],
        'afternoon' => ['¡Buenas tardes', 'Que tenga una excelente tarde', 'Saludos cordiales esta tarde'],
        'night'     => ['¡Buenas noches', 'Le deseamos una noche tranquila', 'Saludos en esta hermosa noche'],
        'default'   => ['Saludos', 'Hola', 'Qué tal'],
    ];

    // Plantillas para voz (TTS), ahora más formales y divertidas
    private array $ttsTemplates = [
        'not_found' => [
            "Código no encontrado.",
            "No te encontré. ¿Intentamos de nuevo?",
            "Usuario no registrado.",
        ],
        'recent_entry' => [
            "Ya estás dentro, {nombre}.",
            "Ya registramos tu entrada, {nombre}.",
        ],
        'recent_exit' => [
            "Ya registramos tu salida, {nombre}.",
            "Ya te fuiste, {nombre}.",
        ],
        'expired' => [
            "{nombre}, matrícula vencida.",
            "Hola, {nombre}. Acceso como visitante.",
        ],
        'birthday' => [
            "¡Feliz cumpleaños, {nombre}!",
            "¡Felicidades, {nombre}!",
        ],
        'borrower_note' => [
            "{nombre}, tienes un mensaje: {note}",
        ],
        // Mensajes de entrada por rol
        'entry' => [
            'DOCEN' => [
                "{prof_title} {nombre}.",
                "Hola, {prof_title} {nombre}.",
                "Adelante, {prof_title} {nombre}.",
            ],
            'INVESTI' => [
                "Hola, {nombre}.",
                "Adelante, {nombre}.",
                "Bienvenid{gender_suffix}, {nombre}.",
            ],
            'STAFF' => [
                "Hola, {nombre}.",
                "Adelante, {nombre}.",
                "Qué tal, {nombre}.",
            ],
            'ADMIN' => [
                "Hola, {nombre}.",
                "Adelante, {nombre}.",
                "Bienvenid{gender_suffix}, {nombre}.",
            ],
            'VISITA' => [
                "Hola, {nombre}.",
                "Bienvenid{gender_suffix}, {nombre}.",
                "Pasa, {nombre}.",
            ],
            'ESTUDI' => [
                "Hola, {nombre}.",
                "Adelante, {nombre}.",
                "Qué tal, {nombre}.",
                "Pasa, {nombre}.",
            ],
            'DEFAULT' => [
                "Hola, {nombre}.",
                "Adelante, {nombre}.",
            ],
        ],
        // Mensajes de salida por rol
        'exit' => [
            'DOCEN' => [
                "Hasta luego, {prof_title} {nombre}.",
                "Nos vemos, {prof_title} {nombre}.",
                "Chau, {prof_title} {nombre}.",
            ],
            'INVESTI' => [
                "Chau, {nombre}.",
                "Nos vemos, {nombre}.",
                "Hasta luego, {nombre}.",
            ],
            'STAFF' => [
                "Chau, {nombre}.",
                "Nos vemos, {nombre}.",
                "Hasta luego, {nombre}.",
            ],
            'ADMIN' => [
                "Hasta luego, {nombre}.",
                "Nos vemos, {nombre}.",
                "Chau, {nombre}.",
            ],
            'VISITA' => [
                "Chau, {nombre}.",
                "Nos vemos, {nombre}.",
                "Hasta luego, {nombre}.",
            ],
            'ESTUDI' => [
                "Chau, {nombre}.",
                "Nos vemos, {nombre}.",
                "Hasta luego, {nombre}.",
                "Hasta pronto, {nombre}.",
            ],
            'DEFAULT' => [
                "Hasta luego, {nombre}.",
                "Nos vemos, {nombre}.",
            ],
        ],
    ];

    // Pantalla solo para datos, puede estar vacío
    private array $screenTemplates = [
        'not_found' => "",
        'recent_entry' => "",
        'recent_exit' => "",
        'expired' => "",
        'birthday' => "",
        'borrower_note' => "",
        'entry' => [],
        'exit' => [],
    ];

    public function getBothMessages(string $eventType, ?array $userData = null, array $miscData = []): array {
        return [
            'visual' => $this->getScreenMessage($eventType, $userData, $miscData),
            'voice'  => $this->getTTSMessage($eventType, $userData, $miscData),
        ];
    }

    public function getScreenMessage(string $eventType, ?array $userData = null, array $miscData = []): string {
        return $this->generateMessage($eventType, $userData, $miscData, $this->screenTemplates);
    }

    public function getTTSMessage(string $eventType, ?array $userData = null, array $miscData = []): string {
        return $this->generateMessage($eventType, $userData, $miscData, $this->ttsTemplates, true);
    }

    /**
     * @param bool $avoidRepeat Si es true (TTS), intenta evitar repetir el último saludo usado.
     */
    private function generateMessage(
        string $eventType,
        ?array $userData,
        array $miscData,
        array $templates,
        bool $avoidRepeat = false
    ): string {
        $combinedData = array_merge($userData ?? [], $miscData);

        // Prepara saludo de hora y género
        $combinedData['greeting'] = $this->getTimeGreeting($miscData['current_hour'] ?? (int)date('H'));
        $gender = strtoupper($userData['gender'] ?? '');
        $combinedData['gender_suffix'] = ($gender == 'F') ? 'a' : 'o';
        $combinedData['prof_title'] = ($gender == 'F') ? 'profesora' : 'profesor';

        // Sin usuario
        if (in_array($eventType, ['not_found', 'recent_entry', 'recent_exit'])) {
            return $this->fetchTemplate($templates, $eventType, $eventType, $avoidRepeat);
        }
        if ($userData === null) return "";

        // Cumpleaños
        if ($this->isBirthday($userData['dateofbirth'] ?? null)) {
            return $this->fetchTemplate($templates, 'birthday', 'birthday', $avoidRepeat, $combinedData);
        }
        // Nota de personal
        if (!empty($userData['borrowernotes'])) {
            $combinedData['note'] = $userData['borrowernotes'];
            return $this->fetchTemplate($templates, 'borrower_note', 'borrower_note', $avoidRepeat, $combinedData);
        }
        // Expirado
        if ($eventType === 'expired') {
            return $this->fetchTemplate($templates, 'expired', 'expired', $avoidRepeat, $combinedData);
        }
        // Entrada
        if ($eventType === 'entry') {
            $msg = $this->buildEntryMessage($userData, $templates, $avoidRepeat, $combinedData);
            return $this->replacePlaceholders($msg, $combinedData);
        }
        // Salida
        if ($eventType === 'exit') {
            $msg = $this->buildExitMessage($userData, $templates, $avoidRepeat, $combinedData);
            return $this->replacePlaceholders($msg, $combinedData);
        }
        return '';
    }

    private function buildEntryMessage(array $userData, array $templates, bool $avoidRepeat, array $combinedData): string {
        $valid = ['DOCEN', 'ADMIN', 'ESTUDI', 'STAFF', 'VISITA', 'INVESTI'];
        $category = strtoupper(trim($userData['categorycode'] ?? ''));
        if (!in_array($category, $valid)) {
            $category = 'DEFAULT';
        }
        $tplSet = $templates['entry'] ?? [];
        $candidates = $tplSet[$category] ?? $tplSet['DEFAULT'] ?? [];
        return $this->pickNonRepeated($candidates, "entry_" . $category, $avoidRepeat, $combinedData);
    }

    private function buildExitMessage(array $userData, array $templates, bool $avoidRepeat, array $combinedData): string {
        $valid = ['DOCEN', 'ADMIN', 'ESTUDI', 'STAFF', 'VISITA', 'INVESTI'];
        $category = strtoupper(trim($userData['categorycode'] ?? ''));
        if (!in_array($category, $valid)) {
            $category = 'DEFAULT';
        }
        $tplSet = $templates['exit'] ?? [];
        $candidates = $tplSet[$category] ?? $tplSet['DEFAULT'] ?? [];
        return $this->pickNonRepeated($candidates, "exit_" . $category, $avoidRepeat, $combinedData);
    }

    /**
     * Elige aleatoriamente evitando repetir el último (si hay más de 1 opción)
     */
    private function fetchTemplate(array $templates, string $key, string $sessionKey, bool $avoidRepeat = false, array $data = []): string {
        $tpl = $templates[$key] ?? '';
        if (is_array($tpl) && count($tpl) > 0) {
            return $this->pickNonRepeated($tpl, $sessionKey, $avoidRepeat, $data);
        }
        return $this->replacePlaceholders($tpl, $data);
    }

    /**
     * Elige una frase al azar evitando la última usada (solo si $avoidRepeat).
     * Guarda la frase elegida en $_SESSION['last_tts'][$sessionKey]
     */
    private function pickNonRepeated(array $options, string $sessionKey, bool $avoidRepeat, array $data = []): string {
        if (empty($options)) return ''; // <-- Esto previene el error si no hay opciones
    
        $lastUsed = $_SESSION['last_tts'][$sessionKey] ?? null;
        $available = $options;
        if ($avoidRepeat && count($available) > 1 && $lastUsed) {
            $available = array_values(array_diff($available, [$lastUsed]));
        }
        if (empty($available)) return ''; // <-- También previene si tras filtrar no quedan opciones
    
        $chosen = $available[array_rand($available)];
        if ($avoidRepeat) {
            $_SESSION['last_tts'][$sessionKey] = $chosen;
        }
        return $this->replacePlaceholders($chosen, $data);
    }

    private function getTimeGreeting(int $hour): string {
        if ($hour >= 5 && $hour < 12) {
            $set = $this->timeGreetings['morning'];
        } elseif ($hour >= 12 && $hour < 19) {
            $set = $this->timeGreetings['afternoon'];
        } elseif ($hour >= 19 || $hour < 5) {
            $set = $this->timeGreetings['night'];
        } else {
            $set = $this->timeGreetings['default'];
        }
        return $set[array_rand($set)];
    }

    private function replacePlaceholders(string $template, array $data): string {
        $placeholders = [
            '{name}'      => htmlspecialchars(explode(' ', trim($data['firstname'] ?? ''))[0], ENT_QUOTES, 'UTF-8'),
            '{firstname}' => htmlspecialchars(explode(' ', trim($data['firstname'] ?? ''))[0], ENT_QUOTES, 'UTF-8'),
            '{nombre}'    => htmlspecialchars(explode(' ', trim($data['firstname'] ?? ''))[0], ENT_QUOTES, 'UTF-8'),
            '{surname}'   => htmlspecialchars($data['surname'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{apellido}'  => htmlspecialchars($data['surname'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{title}'     => htmlspecialchars($data['title'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{titulo}'    => htmlspecialchars($data['title'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{usn}'       => htmlspecialchars($data['usn'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{label}'     => htmlspecialchars($data['label'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{time}'      => htmlspecialchars($data['time'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{duration}'  => htmlspecialchars($data['duration'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{note}'      => htmlspecialchars($data['note'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{greeting}'  => htmlspecialchars($data['greeting'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{gender_suffix}' => htmlspecialchars($data['gender_suffix'] ?? '', ENT_QUOTES, 'UTF-8'),
            '{prof_title}'    => htmlspecialchars($data['prof_title'] ?? '', ENT_QUOTES, 'UTF-8'),
        ];
        $template = str_replace(array_keys($placeholders), array_values($placeholders), $template);
        return preg_replace('/{[^}]+}/', '', $template);
    }

    private function isBirthday(?string $dateOfBirth): bool {
        if (empty($dateOfBirth)) return false;
        $timestamp = strtotime($dateOfBirth);
        if ($timestamp === false) return false;
        return date('m-d') === date('m-d', $timestamp);
    }
}
