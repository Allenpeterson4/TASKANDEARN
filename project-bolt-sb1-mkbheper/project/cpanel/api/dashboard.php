<?php
declare(strict_types=1);

function dashboard_fetch_all(PDO $pdo, string $sql, array $parameters = []): array
{
    $startedAt = microtime(true);
    $statement = $pdo->prepare($sql);
    $statement->execute($parameters);
    $rows = $statement->fetchAll();
    $durationMs = (int)round((microtime(true) - $startedAt) * 1000);
    if ($durationMs >= 1500) {
        $queryLabel = substr((string)preg_replace('/\s+/', ' ', $sql), 0, 200);
        error_log("MrHustler slow dashboard query ({$durationMs}ms): {$queryLabel}");
    }
    return $rows;
}

function dashboard_settings(PDO $pdo, string $userId): array
{
    $plans = dashboard_fetch_all(
        $pdo,
        'SELECT plan_code FROM subscription_plans WHERE is_active = 1 AND price > 0 ORDER BY price ASC LIMIT 1000'
    );
    $subscription = dashboard_fetch_all(
        $pdo,
        'SELECT plan_code FROM user_subscriptions
         WHERE user_id = ? AND status = \'active\'
           AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
         ORDER BY starts_at DESC LIMIT 1',
        [$userId]
    );
    $features = dashboard_fetch_all(
        $pdo,
        'SELECT feature_key, free_enabled, premium_enabled, settings FROM feature_permissions LIMIT 1000'
    );
    $features = normalize_json_columns($features, data_columns($pdo, 'feature_permissions'));

    return [
        'available_plan_codes' => array_column($plans, 'plan_code'),
        'current_plan_code' => $subscription[0]['plan_code'] ?? 'free',
        'feature_permissions' => $features,
    ];
}

function dashboard_snapshot(PDO $pdo, string $userId): array
{
    $profile = dashboard_fetch_all($pdo, 'SELECT * FROM profiles WHERE user_id = ? LIMIT 1', [$userId]);
    $balance = dashboard_fetch_all($pdo, 'SELECT * FROM balances WHERE user_id = ? LIMIT 1', [$userId]);
    $tasks = dashboard_fetch_all(
        $pdo,
        'SELECT id, title, description, category, reward, difficulty, is_active, expires_at, created_at,
                task_url, daily_quota, proof_required, proof_instructions, sort_order, is_funded,
                required_plan_code, verification_mode
         FROM tasks WHERE is_active = 1 ORDER BY sort_order ASC, created_at DESC LIMIT 1000'
    );
    $completions = dashboard_fetch_all(
        $pdo,
        'SELECT id, user_id, task_id, status, completed_at, reviewed_at
         FROM task_completions WHERE user_id = ? LIMIT 1000',
        [$userId]
    );
    $referrals = dashboard_fetch_all(
        $pdo,
        'SELECT id, referrer_id, referred_id, bonus_paid, created_at
         FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 1000',
        [$userId]
    );
    $withdrawals = dashboard_fetch_all(
        $pdo,
        'SELECT id, user_id, amount, wallet_type, bank_name, account_no, account_name, status, requested_at
         FROM withdrawals WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1000',
        [$userId]
    );
    $deposits = dashboard_fetch_all(
        $pdo,
        'SELECT id, amount, status, created_at FROM funding_deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
        [$userId]
    );
    $withdrawalSettings = dashboard_fetch_all(
        $pdo,
        'SELECT hustler_withdrawals_enabled, minimum_hustles, require_all_hustles, minimum_hustle_level,
                minimum_referrals, minimum_checkin_streak, minimum_online_minutes, minimum_interactions, measurement_days
         FROM platform_settings WHERE singleton = 1 LIMIT 1'
    );
    $latestCheckin = dashboard_fetch_all(
        $pdo,
        'SELECT checkin_date, streak, reward FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1',
        [$userId]
    );
    $todayCheckin = dashboard_fetch_all(
        $pdo,
        'SELECT checkin_date, streak, reward FROM daily_checkins WHERE user_id = ? AND checkin_date = UTC_DATE() LIMIT 1',
        [$userId]
    );
    $activity = dashboard_fetch_all(
        $pdo,
        'SELECT * FROM user_activity_daily
         WHERE user_id = ? AND activity_date >= UTC_DATE() - INTERVAL 365 DAY
         ORDER BY activity_date DESC LIMIT 1000',
        [$userId]
    );
    $announcement = dashboard_fetch_all(
        $pdo,
        'SELECT title, message, enabled, welcome_bonus, require_social, social_links
         FROM platform_announcements WHERE singleton = 1 AND enabled = 1 LIMIT 1'
    );
    if ($announcement) {
        $announcement = normalize_json_columns($announcement, data_columns($pdo, 'platform_announcements'));
    }
    $claim = $pdo->prepare('SELECT EXISTS(SELECT 1 FROM welcome_bonus_claims WHERE user_id = ?)');
    $claim->execute([$userId]);
    $advertisement = dashboard_fetch_all(
        $pdo,
        'SELECT image_path, target_url, enabled FROM dashboard_advertisements
         WHERE singleton = 1 AND enabled = 1 AND image_path IS NOT NULL AND target_url IS NOT NULL LIMIT 1'
    );

    return [
        'profile' => $profile[0] ?? null,
        'balance' => $balance[0] ?? null,
        'tasks' => $tasks,
        'completions' => $completions,
        'referrals' => $referrals,
        'withdrawals' => $withdrawals,
        'funding_deposits' => $deposits,
        'withdrawal_settings' => $withdrawalSettings[0] ?? null,
        'latest_checkin' => $latestCheckin[0] ?? null,
        'today_checkin' => $todayCheckin[0] ?? null,
        'activity' => $activity,
        'announcement' => $announcement[0] ?? null,
        'announcement_claimed' => (bool)$claim->fetchColumn(),
        'advertisement' => $advertisement[0] ?? null,
        ...dashboard_settings($pdo, $userId),
    ];
}
