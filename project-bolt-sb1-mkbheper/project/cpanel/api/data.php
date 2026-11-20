<?php
declare(strict_types=1);

function data_table_policies(): array
{
    return [
        'profiles' => ['scope' => 'user_id', 'public' => false, 'member_write' => ['full_name', 'username', 'phone', 'avatar_url', 'public_activity_opt_in', 'leaderboard_opt_in']],
        'balances' => ['scope' => 'user_id', 'public' => false],
        'subscription_plans' => ['public' => true, 'admin_write' => true],
        'tasks' => ['public' => true, 'admin_write' => true],
        'task_completions' => ['scope' => 'user_id', 'public' => false],
        'referrals' => ['scope' => 'referral', 'public' => false],
        'withdrawals' => ['scope' => 'user_id', 'public' => false],
        'wallet_ledger' => ['scope' => 'user_id', 'public' => false],
        'user_subscriptions' => ['scope' => 'user_id', 'public' => false],
        'funding_settings' => ['public' => true, 'admin_write' => true],
        'funding_deposits' => ['scope' => 'user_id', 'public' => false],
        'site_content' => ['public' => true, 'admin_write' => true],
        'platform_settings' => ['public' => true, 'admin_write' => true],
        'daily_checkins' => ['scope' => 'user_id', 'public' => false],
        'user_activity_daily' => ['scope' => 'user_id', 'public' => false],
        'reward_milestones' => ['scope' => 'user_id', 'public' => false],
        'leaderboard_reward_settings' => ['public' => true, 'admin_write' => true],
        'leaderboard_reward_runs' => ['admin_only' => true],
        'dashboard_advertisements' => ['public' => true, 'admin_write' => true],
        'feature_permissions' => ['public' => true, 'admin_write' => true],
        'platform_announcements' => ['public' => true, 'admin_write' => true],
        'welcome_bonus_claims' => ['scope' => 'user_id', 'public' => false],
        'payout_settings' => ['public' => true, 'admin_write' => true],
        'campaign_submissions' => ['scope' => 'user_id', 'public' => false],
        'task_verification_sessions' => ['scope' => 'user_id', 'public' => false],
        'task_verification_events' => ['scope' => 'user_id', 'public' => false],
        'support_conversations' => ['scope' => 'user_id', 'public' => false],
        'support_messages' => ['scope' => 'support_messages', 'public' => false],
        'admin_activity_log' => ['admin_only' => true],
        'user_login_history' => ['admin_only' => true],
        'email_notification_templates' => ['admin_only' => true, 'admin_write' => true],
    ];
}

function record_admin_activity(PDO $pdo, string $actorId, string $action, array $details, ?string $subjectUserId = null): void
{
    $pdo->prepare(
        'INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)'
    )->execute([uuid_v4(), $actorId, $subjectUserId, $action, json_encode($details, JSON_THROW_ON_ERROR)]);
}

function data_columns(PDO $pdo, string $table): array
{
    static $cache = [];
    if (isset($cache[$table])) return $cache[$table];
    $statement = $pdo->query('SHOW COLUMNS FROM `' . $table . '`');
    $columns = [];
    foreach ($statement->fetchAll() as $row) $columns[$row['Field']] = strtoupper((string)$row['Type']);
    return $cache[$table] = $columns;
}

function data_filters(array $filters, array $columns, array &$parameters): array
{
    $clauses = [];
    $operators = ['eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='];
    foreach ($filters as $filter) {
        $column = (string)($filter['column'] ?? '');
        $operator = (string)($filter['operator'] ?? '');
        $value = $filter['value'] ?? null;
        if (!isset($columns[$column])) throw new InvalidArgumentException('Unknown column in query filter.');
        $quoted = '`' . $column . '`';
        if ($operator === 'in') {
            if (!is_array($value)) throw new InvalidArgumentException('The in filter requires a list.');
            if ($value === []) $clauses[] = '1 = 0';
            else {
                $clauses[] = $quoted . ' IN (' . implode(', ', array_fill(0, count($value), '?')) . ')';
                array_push($parameters, ...$value);
            }
        } elseif ($operator === 'is') {
            if ($value === null) $clauses[] = $quoted . ' IS NULL';
            else {
                $clauses[] = $quoted . ' = ?';
                $parameters[] = $value;
            }
        } elseif ($operator === 'or-null-gt') {
            $clauses[] = '(' . $quoted . ' IS NULL OR ' . $quoted . ' > ?)';
            $parameters[] = $value;
        } elseif ($operator === 'not-is' && $value === null) {
            $clauses[] = $quoted . ' IS NOT NULL';
        } elseif (isset($operators[$operator])) {
            if ($value === null && in_array($operator, ['eq', 'neq'], true)) $clauses[] = $quoted . ($operator === 'eq' ? ' IS NULL' : ' IS NOT NULL');
            else {
                $clauses[] = $quoted . ' ' . $operators[$operator] . ' ?';
                $parameters[] = $value;
            }
        } else {
            throw new InvalidArgumentException('Unsupported query filter.');
        }
    }

    return $clauses;
}

function data_scope(array $policy, ?array $user, array &$parameters): ?string
{
    if (!empty($policy['admin_only']) && (!$user || ($user['app_metadata']['role'] ?? '') !== 'admin')) {
        respond(['error' => 'Administrator access is required.'], 403);
    }
    if ($user && ($user['app_metadata']['role'] ?? '') === 'admin') {
        require_admin_scope($user);
        return null;
    }
    if (empty($policy['public']) && !$user) respond(['error' => 'Sign in to access this resource.'], 401);
    $scope = $policy['scope'] ?? null;
    if ($scope === 'referral') {
        $parameters[] = $user['id'];
        $parameters[] = $user['id'];
        return '(`referrer_id` = ? OR `referred_id` = ?)';
    }
    if ($scope === 'support_messages') {
        $parameters[] = $user['id'];
        return 'EXISTS (SELECT 1 FROM `support_conversations` sc WHERE sc.id = `support_messages`.`conversation_id` AND sc.user_id = ?)';
    }
    if (is_string($scope)) {
        $parameters[] = $user['id'];
        return '`' . $scope . '` = ?';
    }
    return null;
}

function require_admin_scope(array $user): void
{
    if (($user['app_metadata']['mfa_required'] ?? false) && !($user['app_metadata']['mfa_verified'] ?? false)) {
        respond(['error' => 'Complete administrator verification first.'], 403);
    }
}

function data_identifiers(array $requested, array $columns): array
{
    $result = [];
    foreach ($requested as $column) {
        $column = trim((string)$column);
        if ($column === '*') return array_keys($columns);
        if (!isset($columns[$column]) || !preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $column)) {
            throw new InvalidArgumentException('Unknown column in query.');
        }
        $result[] = $column;
    }
    return array_values(array_unique($result));
}

function normalize_json_columns(array $rows, array $columns): array
{
    $jsonColumns = [];
    foreach ($columns as $name => $type) if (str_starts_with($type, 'JSON')) $jsonColumns[$name] = true;
    foreach ($rows as &$row) {
        foreach ($jsonColumns as $column => $_) {
            if (isset($row[$column]) && is_string($row[$column])) {
                $decoded = json_decode($row[$column], true);
                if (json_last_error() === JSON_ERROR_NONE) $row[$column] = $decoded;
            }
        }
    }
    return $rows;
}

function execute_data_request(PDO $pdo, array $config, array $body): array
{
    $table = (string)($body['table'] ?? '');
    $action = (string)($body['action'] ?? 'select');
    $policies = data_table_policies();
    if (!isset($policies[$table])) throw new InvalidArgumentException('Unknown data resource.');
    $policy = $policies[$table];
    $columns = data_columns($pdo, $table);
    $user = request_user($pdo, $config);
    $parameters = [];
    $filters = data_filters(is_array($body['filters'] ?? null) ? $body['filters'] : [], $columns, $parameters);
    $scope = data_scope($policy, $user, $parameters);
    if ($scope !== null) $filters[] = $scope;
    if ($table === 'tasks' && (!$user || ($user['app_metadata']['role'] ?? '') !== 'admin')) {
        $filters[] = '`is_active` = 1';
    }

    if ($action === 'select') {
        $requestedColumns = is_array($body['columns'] ?? null) ? $body['columns'] : ['*'];
        $selected = data_identifiers($requestedColumns, $columns);
        $where = $filters ? ' WHERE ' . implode(' AND ', $filters) : '';
        $count = null;
        if (!empty($body['count'])) {
            $countStatement = $pdo->prepare('SELECT COUNT(*) FROM `' . $table . '`' . $where);
            $countStatement->execute($parameters);
            $count = (int)$countStatement->fetchColumn();
        }
        if (!empty($body['head'])) return ['data' => null, 'count' => $count];

        $order = [];
        foreach (($body['order'] ?? []) as $ordering) {
            $column = (string)($ordering['column'] ?? '');
            if (!isset($columns[$column])) throw new InvalidArgumentException('Unknown column in order clause.');
            $order[] = '`' . $column . '` ' . (!empty($ordering['ascending']) ? 'ASC' : 'DESC');
        }
        $limit = max(0, min(1000, (int)($body['limit'] ?? 100)));
        $sql = 'SELECT ' . implode(', ', array_map(static fn(string $column): string => '`' . $column . '`', $selected))
            . ' FROM `' . $table . '`' . $where
            . ($order ? ' ORDER BY ' . implode(', ', $order) : '')
            . ' LIMIT ' . $limit . ' OFFSET ' . max(0, (int)($body['offset'] ?? 0));
        $statement = $pdo->prepare($sql);
        $statement->execute($parameters);
        $rows = normalize_json_columns($statement->fetchAll(), $columns);
        $cardinality = $body['cardinality'] ?? '';
        if ($cardinality === 'single') {
            if (count($rows) !== 1) throw new RuntimeException('Expected exactly one row.');
            return ['data' => $rows[0], 'count' => $count];
        }
        if ($cardinality === 'maybeSingle') {
            if (count($rows) > 1) throw new RuntimeException('Expected at most one row.');
            return ['data' => $rows[0] ?? null, 'count' => $count];
        }
        return ['data' => $rows, 'count' => $count];
    }

    if (!$user) respond(['error' => 'Sign in to change data.'], 401);
    $isAdmin = ($user['app_metadata']['role'] ?? '') === 'admin';
    if ($isAdmin) require_admin($pdo, $config);
    if ($table === 'profiles' && !$isAdmin) {
        if ($action !== 'update') respond(['error' => 'Profile creation is not allowed.'], 403);
        $allowed = $policy['member_write'];
    } elseif (!$isAdmin || empty($policy['admin_write'])) {
        respond(['error' => 'Changes to this resource are not allowed.'], 403);
    }

    if (!in_array($action, ['insert', 'upsert', 'update', 'delete'], true)) throw new InvalidArgumentException('Unsupported data operation.');
    if ($action === 'delete' && $table !== 'tasks' && $table !== 'site_content') {
        respond(['error' => 'Delete is not allowed for this resource.'], 403);
    }
    if ($action === 'delete') {
        if (!$filters) respond(['error' => 'A delete operation must include a filter.'], 422);
        $tasksToAudit = [];
        if ($table === 'tasks') {
            $pdo->beginTransaction();
            $select = $pdo->prepare('SELECT id, title FROM tasks WHERE ' . implode(' AND ', $filters));
            $select->execute($parameters);
            $tasksToAudit = $select->fetchAll();
        }
        $statement = $pdo->prepare('DELETE FROM `' . $table . '` WHERE ' . implode(' AND ', $filters));
        $statement->execute($parameters);
        foreach ($tasksToAudit as $task) {
            record_admin_activity($pdo, (string)$user['id'], 'task_catalog_delete', [
                'task_id' => $task['id'],
                'title' => $task['title'],
            ]);
        }
        if ($table === 'tasks') $pdo->commit();
        return ['data' => null];
    }

    $values = $body['values'] ?? [];
    if (!is_array($values) || $values === []) throw new InvalidArgumentException('Data changes must include values.');
    if (array_is_list($values) && isset($values[0]) && is_array($values[0])) $rows = $values;
    else $rows = [$values];
    if ($table === 'profiles' && !$isAdmin) {
        $allowed = $policy['member_write'];
        foreach ($rows as $row) if (array_diff(array_keys($row), $allowed)) respond(['error' => 'This profile field cannot be changed.'], 403);
    }

    if ($table === 'tasks') $pdo->beginTransaction();
    foreach ($rows as $row) {
        if (!is_array($row) || $row === []) throw new InvalidArgumentException('Invalid data row.');
        foreach (array_keys($row) as $column) {
            if (!isset($columns[$column]) || !preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', (string)$column)) {
                throw new InvalidArgumentException('Unknown field in data row.');
            }
        }
        if ($action === 'update') {
            if (!$filters) respond(['error' => 'An update operation must include a filter.'], 422);
            $sets = [];
            $setParameters = [];
            foreach ($row as $column => $value) {
                $sets[] = '`' . $column . '` = ?';
                $setParameters[] = is_array($value) ? json_encode($value, JSON_THROW_ON_ERROR) : $value;
            }
            $statement = $pdo->prepare('UPDATE `' . $table . '` SET ' . implode(', ', $sets) . ' WHERE ' . implode(' AND ', $filters));
            $statement->execute([...$setParameters, ...$parameters]);
            if ($table === 'tasks') {
                $taskQuery = $pdo->prepare('SELECT id, title FROM tasks WHERE ' . implode(' AND ', $filters));
                $taskQuery->execute($parameters);
                foreach ($taskQuery->fetchAll() as $task) {
                    record_admin_activity($pdo, (string)$user['id'], 'task_catalog_update', [
                        'task_id' => $task['id'],
                        'title' => $task['title'],
                    ]);
                }
            }
        } else {
            $existingTask = null;
            if ($table === 'tasks' && $action === 'upsert' && isset($row['id'])) {
                $existingQuery = $pdo->prepare('SELECT id FROM tasks WHERE id = ? LIMIT 1');
                $existingQuery->execute([$row['id']]);
                $existingTask = $existingQuery->fetchColumn();
            }
            $fieldNames = array_keys($row);
            $insertSql = 'INSERT INTO `' . $table . '` (' . implode(', ', array_map(static fn(string $field): string => '`' . $field . '`', $fieldNames)) . ') VALUES ('
                . implode(', ', array_fill(0, count($fieldNames), '?')) . ')';
            if ($action === 'upsert') {
                $updates = array_values(array_diff($fieldNames, ['id', 'singleton', 'user_id', 'plan_code', 'content_key', 'feature_key', 'rank', 'event_key']));
                if ($updates === []) $updates = [$fieldNames[0]];
                $insertSql .= ' ON DUPLICATE KEY UPDATE ' . implode(', ', array_map(
                    static fn(string $field): string => '`' . $field . '` = VALUES(`' . $field . '`)',
                    $updates
                ));
            }
            $statement = $pdo->prepare($insertSql);
            $statement->execute(array_map(static fn($value) => is_array($value) ? json_encode($value, JSON_THROW_ON_ERROR) : $value, array_values($row)));
            if ($table === 'tasks' && isset($row['id'])) {
                $taskQuery = $pdo->prepare('SELECT id, title FROM tasks WHERE id = ? LIMIT 1');
                $taskQuery->execute([$row['id']]);
                $task = $taskQuery->fetch();
                if ($task) {
                    $taskAction = $existingTask ? 'task_catalog_update' : 'task_catalog_insert';
                    record_admin_activity($pdo, (string)$user['id'], $taskAction, [
                        'task_id' => $task['id'],
                        'title' => $task['title'],
                    ]);
                }
            }
        }
    }
    if ($table === 'tasks') $pdo->commit();

    if (!empty($body['returnRows'])) {
        $select = $pdo->prepare('SELECT * FROM `' . $table . '` WHERE ' . implode(' AND ', $filters ?: ['1=0']) . ' LIMIT 2');
        $select->execute($parameters);
        $rows = normalize_json_columns($select->fetchAll(), $columns);
        if (($body['cardinality'] ?? '') === 'single' && count($rows) !== 1) throw new RuntimeException('Expected exactly one row.');
        if (($body['cardinality'] ?? '') === 'maybeSingle') {
            if (count($rows) > 1) throw new RuntimeException('Expected at most one row.');
            return ['data' => $rows[0] ?? null];
        }
        return ['data' => $rows];
    }
    return ['data' => null];
}
