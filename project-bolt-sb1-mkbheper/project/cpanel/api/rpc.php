<?php
declare(strict_types=1);

function rpc_authenticated_user(PDO $pdo, array $config): array
{
    $user = request_user($pdo, $config);
    if (!$user) respond(['error' => 'Sign in to continue.'], 401);
    return $user;
}

function queue_email_notification(PDO $pdo, ?string $userId, string $eventKey, array $payload): void
{
    if ($userId === null || $userId === '') return;
    $pdo->prepare('INSERT INTO email_notification_queue (user_id, event_key, payload) VALUES (?, ?, ?)')
        ->execute([$userId, $eventKey, json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)]);
}

function queue_task_review_email(PDO $pdo, string $userId, string $taskId, string $status, ?string $reviewNote): void
{
    $taskQuery = $pdo->prepare('SELECT title, reward FROM tasks WHERE id = ?');
    $taskQuery->execute([$taskId]);
    $task = $taskQuery->fetch() ?: ['title' => 'Hustle', 'reward' => 0];
    if ($status === 'approved') {
        queue_email_notification($pdo, $userId, 'hustle_approved', [
            'task_title' => $task['title'],
            'reward_message' => 'Reward: ' . $task['reward'],
        ]);
        $countQuery = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved'");
        $countQuery->execute([$userId]);
        if ((int)$countQuery->fetchColumn() === 1) {
            $referrerQuery = $pdo->prepare('SELECT referrer_id FROM referrals WHERE referred_id = ?');
            $referrerQuery->execute([$userId]);
            $referrerId = $referrerQuery->fetchColumn();
            if ($referrerId) {
                $profileQuery = $pdo->prepare("SELECT COALESCE(NULLIF(full_name, ''), 'Your referral') FROM profiles WHERE user_id = ?");
                $profileQuery->execute([$userId]);
                $balanceQuery = $pdo->prepare('SELECT referral_balance FROM balances WHERE user_id = ?');
                $balanceQuery->execute([$referrerId]);
                queue_email_notification($pdo, (string)$referrerId, 'referral_first_hustle', [
                    'referred_name' => $profileQuery->fetchColumn() ?: 'Your referral',
                    'bonus_status' => (float)($balanceQuery->fetchColumn() ?: 0) > 0 ? 'credited' : 'being processed',
                ]);
            }
        }
    } elseif ($status === 'rejected') {
        queue_email_notification($pdo, $userId, 'hustle_rejected', [
            'task_title' => $task['title'],
            'review_note' => $reviewNote ?: 'Please review the submission requirements.',
        ]);
    }
}

function queue_subscription_activated_email(PDO $pdo, string $userId, string $planCode): void
{
    $query = $pdo->prepare('SELECT name FROM subscription_plans WHERE plan_code = ?');
    $query->execute([$planCode]);
    queue_email_notification($pdo, $userId, 'subscription_activated', [
        'plan_name' => $query->fetchColumn() ?: $planCode,
        'event_date' => gmdate('Y-m-d'),
    ]);
}

function user_feature_enabled(PDO $pdo, string $userId, string $featureKey): bool
{
    $premiumQuery = $pdo->prepare(
        "SELECT EXISTS(
           SELECT 1 FROM user_subscriptions s JOIN subscription_plans p USING (plan_code)
           WHERE s.user_id = ? AND s.status = 'active' AND p.price > 0
             AND s.starts_at <= UTC_TIMESTAMP(3) AND (s.ends_at IS NULL OR s.ends_at > UTC_TIMESTAMP(3))
         )"
    );
    $premiumQuery->execute([$userId]);
    $premium = (bool)$premiumQuery->fetchColumn();
    $featureQuery = $pdo->prepare('SELECT free_enabled, premium_enabled FROM feature_permissions WHERE feature_key = ?');
    $featureQuery->execute([$featureKey]);
    $feature = $featureQuery->fetch();
    return !$feature || (bool)$feature[$premium ? 'premium_enabled' : 'free_enabled'];
}

function record_wallet_ledger(
    PDO $pdo,
    string $ledgerId,
    string $userId,
    ?string $actorId,
    string $balanceType,
    string|int|float $amount,
    string|int|float $balanceBefore,
    string|int|float $balanceAfter,
    string $reason
): void {
    $pdo->prepare(
        'INSERT INTO wallet_ledger (id, user_id, actor_id, balance_type, amount, balance_before, balance_after, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([$ledgerId, $userId, $actorId, $balanceType, $amount, $balanceBefore, $balanceAfter, $reason]);
    if ($actorId !== null) {
        $details = json_encode([
            'balance_type' => $balanceType,
            'amount' => (float)$amount,
            'reason' => $reason,
            'ledger_id' => $ledgerId,
        ], JSON_THROW_ON_ERROR);
        $pdo->prepare(
            'INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)'
        )->execute([uuid_v4(), $actorId, $userId, 'wallet_adjustment', $details]);
    }
}

function credit_referral_event(PDO $pdo, string $referralId, string $actorId, string $rewardType, float $amount, string $reason): void
{
    if ($amount <= 0) return;
    $event = $pdo->prepare('INSERT IGNORE INTO referral_reward_events (id, referral_id, reward_type, amount) VALUES (?, ?, ?, ?)');
    $event->execute([uuid_v4(), $referralId, $rewardType, $amount]);
    if ($event->rowCount() === 0) return;
    $referrerQuery = $pdo->prepare('SELECT referrer_id FROM referrals WHERE id = ?');
    $referrerQuery->execute([$referralId]);
    $referrerId = $referrerQuery->fetchColumn();
    if (!$referrerId) throw new RuntimeException('Referral record not found while issuing a reward.');
    $balanceQuery = $pdo->prepare('SELECT referral_balance FROM balances WHERE user_id = ? FOR UPDATE');
    $balanceQuery->execute([$referrerId]);
    $before = $balanceQuery->fetchColumn();
    if ($before === false) throw new RuntimeException('Referrer wallet not found while issuing a reward.');
    $after = (float)$before + $amount;
    if ($after >= 10000000000) throw new RuntimeException('Referral reward exceeds the wallet balance limit.');
    $pdo->prepare('UPDATE balances SET referral_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
        ->execute([$after, $amount, $referrerId]);
    record_wallet_ledger($pdo, uuid_v4(), $referrerId, $actorId, 'referral', $amount, $before, $after, $reason);
}

function award_referral_signup_reward(PDO $pdo, string $referralId, string $actorId): void
{
    $amount = (float)$pdo->query('SELECT referral_signup_reward FROM platform_settings WHERE singleton = 1')->fetchColumn();
    credit_referral_event($pdo, $referralId, $actorId, 'signup', $amount, 'Referral signup reward');
}

function award_referral_first_hustle_reward(PDO $pdo, string $userId): void
{
    $query = $pdo->prepare('SELECT id, referrer_id FROM referrals WHERE referred_id = ?');
    $query->execute([$userId]);
    $referral = $query->fetch();
    if (!$referral) return;
    $amount = (float)$pdo->query('SELECT referral_first_hustle_reward FROM platform_settings WHERE singleton = 1')->fetchColumn();
    credit_referral_event($pdo, (string)$referral['id'], (string)$referral['referrer_id'], 'first_hustle', $amount, 'Referral first-hustle reward');
    if ($amount > 0) $pdo->prepare('UPDATE referrals SET bonus_paid = 1 WHERE id = ?')->execute([$referral['id']]);
}

function award_milestone_rewards(PDO $pdo, string $userId, string $type, int $count): void
{
    $bonus = (float)$pdo->query('SELECT milestone_reward FROM platform_settings WHERE singleton = 1')->fetchColumn();
    if ($bonus <= 0) return;
    $balanceColumn = $type === 'hustles' ? 'reward_balance' : 'referral_balance';
    $insertMilestone = $pdo->prepare('INSERT IGNORE INTO reward_milestones (id, user_id, milestone_type, milestone_value) VALUES (?, ?, ?, ?)');
    $balanceQuery = $pdo->prepare("SELECT {$balanceColumn} FROM balances WHERE user_id = ? FOR UPDATE");
    $updateBalance = $pdo->prepare("UPDATE balances SET {$balanceColumn} = ?, total_earned = total_earned + ? WHERE user_id = ?");
    for ($milestone = 100; $milestone <= $count; $milestone += 100) {
        $insertMilestone->execute([uuid_v4(), $userId, $type, $milestone]);
        if ($insertMilestone->rowCount() === 0) continue;
        $balanceQuery->execute([$userId]);
        $before = $balanceQuery->fetchColumn();
        if ($before === false) throw new RuntimeException('Wallet not found while issuing a milestone reward.');
        $after = (float)$before + $bonus;
        if ($after >= 10000000000) throw new RuntimeException('Milestone reward exceeds the wallet balance limit.');
        $updateBalance->execute([$after, $bonus, $userId]);
        $ledgerType = $type === 'hustles' ? 'reward' : 'referral';
        record_wallet_ledger(
            $pdo,
            uuid_v4(),
            $userId,
            $userId,
            $ledgerType,
            $bonus,
            $before,
            $after,
            ucfirst($type) . ' milestone: ' . $milestone . ' ' . $type
        );
    }
}

function complete_verified_task_session(PDO $pdo, string $sessionId, ?string $providerReference): string
{
    $pdo->beginTransaction();
    $sessionQuery = $pdo->prepare('SELECT *, (expires_at <= UTC_TIMESTAMP(3)) AS is_expired FROM task_verification_sessions WHERE id = ? FOR UPDATE');
    $sessionQuery->execute([$sessionId]);
    $session = $sessionQuery->fetch();
    if (!$session) respond(['error' => 'Verification session not found.'], 404);
    if ($session['status'] === 'completed' && $session['completion_id']) {
        $pdo->commit();
        return (string)$session['completion_id'];
    }
    if ($session['status'] !== 'started' || (bool)$session['is_expired']) {
        if ($session['status'] === 'started') {
            $pdo->prepare("UPDATE task_verification_sessions SET status = 'expired' WHERE id = ?")->execute([$sessionId]);
            $pdo->prepare(
                "INSERT INTO task_verification_events (id, session_id, user_id, task_id, result, provider_reference)
                 VALUES (?, ?, ?, ?, 'expired', ?)"
            )->execute([uuid_v4(), $sessionId, $session['user_id'], $session['task_id'], $providerReference]);
            $pdo->commit();
        }
        respond(['error' => 'Verification session has expired.'], 409);
    }

    $profileQuery = $pdo->prepare("SELECT user_id FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
    $profileQuery->execute([$session['user_id']]);
    if (!$profileQuery->fetch()) respond(['error' => 'Hustler account is not active.'], 409);
    $taskQuery = $pdo->prepare(
        "SELECT * FROM tasks WHERE id = ? AND is_active = 1 AND is_funded = 1 AND verification_mode = 'automatic'
         AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
         AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3)) FOR UPDATE"
    );
    $taskQuery->execute([$session['task_id']]);
    $task = $taskQuery->fetch();
    if (!$task) respond(['error' => 'Hustle is not eligible for automatic credit.'], 409);

    $feature = $pdo->prepare("SELECT free_enabled, premium_enabled FROM feature_permissions WHERE feature_key = 'hustles'");
    $feature->execute();
    $featureSettings = $feature->fetch();
    $planQuery = $pdo->prepare(
        "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
         AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
         ORDER BY starts_at DESC LIMIT 1"
    );
    $planQuery->execute([$session['user_id']]);
    $planCode = $planQuery->fetchColumn() ?: 'free';
    $rank = static fn(string $code): int => match ($code) {
        'premium' => 1,
        'vip' => 2,
        'president' => 3,
        default => 0,
    };
    if ($featureSettings && !(bool)$featureSettings[$planCode === 'free' ? 'free_enabled' : 'premium_enabled']) {
        respond(['error' => 'Hustles are not available for this plan.'], 409);
    }
    $planQuery = $pdo->prepare('SELECT daily_task_limit, daily_earning_cap FROM subscription_plans WHERE plan_code = ? AND is_active = 1');
    $planQuery->execute([$planCode]);
    $plan = $planQuery->fetch();
    $requiredPlanQuery = $pdo->prepare('SELECT is_active FROM subscription_plans WHERE plan_code = ?');
    $requiredPlanQuery->execute([$task['required_plan_code']]);
    if (!$plan || !$requiredPlanQuery->fetchColumn() || $rank($planCode) < $rank((string)$task['required_plan_code'])) {
        respond(['error' => 'Hustle plan requirement is not met.'], 409);
    }
    $dailyQuery = $pdo->prepare(
        "SELECT COUNT(*) AS completion_count, COALESCE(SUM(t.reward), 0) AS earned
         FROM task_completions c JOIN tasks t ON t.id = c.task_id
         WHERE c.user_id = ? AND c.status IN ('pending', 'approved') AND c.completed_at >= UTC_DATE()"
    );
    $dailyQuery->execute([$session['user_id']]);
    $daily = $dailyQuery->fetch();
    if ((int)$daily['completion_count'] >= (int)$plan['daily_task_limit']
        || ($plan['daily_earning_cap'] !== null && (float)$daily['earned'] + (float)$task['reward'] > (float)$plan['daily_earning_cap'])) {
        respond(['error' => 'Daily hustle limits have been reached.'], 409);
    }
    if ((int)$task['daily_quota'] > 0) {
        $quota = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status IN ('pending', 'approved') AND completed_at >= UTC_DATE()");
        $quota->execute([$session['task_id']]);
        if ((int)$quota->fetchColumn() >= (int)$task['daily_quota']) respond(['error' => 'Hustle daily quota reached.'], 409);
    }
    if ($task['campaign_budget_remaining'] !== null) {
        $reservations = $pdo->prepare(
            "SELECT (SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status = 'pending')
             + (SELECT COUNT(*) FROM task_verification_sessions WHERE task_id = ? AND status = 'started' AND expires_at > UTC_TIMESTAMP(3))"
        );
        $reservations->execute([$session['task_id'], $session['task_id']]);
        if ((float)$task['campaign_budget_remaining'] < (float)$task['reward'] * (int)$reservations->fetchColumn()) {
            respond(['error' => 'Campaign funds are reserved for active submissions.'], 409);
        }
    }
    $completionQuery = $pdo->prepare('SELECT id, status FROM task_completions WHERE user_id = ? AND task_id = ? FOR UPDATE');
    $completionQuery->execute([$session['user_id'], $session['task_id']]);
    $existingCompletion = $completionQuery->fetch();
    if ($existingCompletion && $existingCompletion['status'] !== 'rejected') respond(['error' => 'Hustle was already credited.'], 409);
    $completionId = $existingCompletion ? (string)$existingCompletion['id'] : uuid_v4();
    if ($existingCompletion) {
        $pdo->prepare(
            "UPDATE task_completions SET status = 'approved', completed_at = UTC_TIMESTAMP(3), reviewed_at = UTC_TIMESTAMP(3),
             reviewed_by = NULL, proof_text = NULL, proof_path = NULL, review_note = 'Verified by partner callback'
             WHERE id = ?"
        )->execute([$completionId]);
    } else {
        $pdo->prepare(
            "INSERT INTO task_completions (id, user_id, task_id, status, review_note, reviewed_at)
             VALUES (?, ?, ?, 'approved', 'Verified by partner callback', UTC_TIMESTAMP(3))"
        )->execute([$completionId, $session['user_id'], $session['task_id']]);
    }
    $balanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
    $balanceQuery->execute([$session['user_id']]);
    $balanceBefore = $balanceQuery->fetchColumn();
    if ($balanceBefore === false) respond(['error' => 'Hustler wallet not found.'], 409);
    $balanceAfter = (float)$balanceBefore + (float)$task['reward'];
    if ($balanceAfter >= 10000000000) respond(['error' => 'Hustler wallet limit exceeded.'], 409);
    $pdo->prepare('UPDATE balances SET reward_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
        ->execute([$balanceAfter, $task['reward'], $session['user_id']]);
    record_wallet_ledger(
        $pdo,
        uuid_v4(),
        (string)$session['user_id'],
        null,
        'reward',
        $task['reward'],
        $balanceBefore,
        $balanceAfter,
        'Automatically verified hustle ' . $session['task_id']
    );
    award_referral_first_hustle_reward($pdo, (string)$session['user_id']);
    $approvedCount = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved'");
    $approvedCount->execute([$session['user_id']]);
    award_milestone_rewards($pdo, (string)$session['user_id'], 'hustles', (int)$approvedCount->fetchColumn());
    queue_task_review_email($pdo, (string)$session['user_id'], (string)$session['task_id'], 'approved', null);

    $referrerQuery = $pdo->prepare(
        "SELECT r.referrer_id FROM referrals r JOIN profiles p ON p.user_id = r.referrer_id
         WHERE r.referred_id = ? AND p.account_status = 'active' FOR UPDATE"
    );
    $referrerQuery->execute([$session['user_id']]);
    $referrerId = $referrerQuery->fetchColumn();
    if ($referrerId) {
        $refPlanQuery = $pdo->prepare(
            "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
             AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
             ORDER BY starts_at DESC LIMIT 1"
        );
        $refPlanQuery->execute([$referrerId]);
        $refPlanCode = $refPlanQuery->fetchColumn() ?: 'free';
        $commissionQuery = $pdo->prepare('SELECT referral_commission_percent FROM subscription_plans WHERE plan_code = ? AND is_active = 1');
        $commissionQuery->execute([$refPlanCode]);
        $commission = round((float)$task['reward'] * (float)($commissionQuery->fetchColumn() ?: 0) / 100, 2);
        if ($commission > 0) {
            $refBalanceQuery = $pdo->prepare('SELECT referral_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $refBalanceQuery->execute([$referrerId]);
            $refBefore = $refBalanceQuery->fetchColumn();
            if ($refBefore === false) respond(['error' => 'Referrer wallet not found.'], 409);
            $refAfter = (float)$refBefore + $commission;
            if ($refAfter >= 10000000000) respond(['error' => 'Referrer wallet limit exceeded.'], 409);
            $pdo->prepare('UPDATE balances SET referral_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
                ->execute([$refAfter, $commission, $referrerId]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$referrerId,
                null,
                'referral',
                $commission,
                $refBefore,
                $refAfter,
                'Referral commission for verified hustle ' . $session['task_id']
            );
        }
    }
    if ($task['campaign_budget_remaining'] !== null) {
        $remaining = (float)$task['campaign_budget_remaining'] - (float)$task['reward'];
        $pdo->prepare('UPDATE tasks SET campaign_budget_remaining = ?, is_active = ? WHERE id = ?')
            ->execute([$remaining, $remaining >= (float)$task['reward'] ? 1 : 0, $session['task_id']]);
    }
    $pdo->prepare(
        "UPDATE task_verification_sessions SET status = 'completed', provider_reference = ?, completion_id = ?,
         completed_at = UTC_TIMESTAMP(3) WHERE id = ?"
    )->execute([$providerReference, $completionId, $sessionId]);
    $pdo->prepare(
        "INSERT INTO task_verification_events (id, session_id, user_id, task_id, result, provider_reference)
         VALUES (?, ?, ?, ?, 'verified', ?)"
    )->execute([uuid_v4(), $sessionId, $session['user_id'], $session['task_id'], $providerReference]);
    $pdo->commit();
    return $completionId;
}

function execute_rpc_request(PDO $pdo, array $config, string $name, array $args): mixed
{
    if ($name === 'get_public_payout_feed') {
        $statement = $pdo->query(
            "SELECT CASE WHEN NULLIF(TRIM(p.full_name), '') IS NULL THEN 'Member'
                         ELSE CONCAT(LEFT(TRIM(p.full_name), 1), '***') END AS member_label,
                    w.amount, w.bank_name, w.processed_at AS paid_at
             FROM withdrawals w JOIN profiles p ON p.user_id = w.user_id
             WHERE w.status = 'paid' AND w.processed_at >= UTC_TIMESTAMP(3) - INTERVAL 30 DAY
               AND p.public_activity_opt_in = 1
             ORDER BY w.processed_at DESC LIMIT 12"
        );
        return $statement->fetchAll();
    }

    $user = rpc_authenticated_user($pdo, $config);
    $userId = (string)$user['id'];
    $isAdmin = ($user['app_metadata']['role'] ?? '') === 'admin';
    if ($isAdmin) require_admin($pdo, $config);

    if ($name === 'admin_email_queue_stats') {
        require_admin($pdo, $config);
        $statement = $pdo->query(
            "SELECT
              SUM(status = 'pending') AS pending,
              SUM(status = 'failed') AS failed,
              SUM(status = 'sent') AS sent
             FROM email_notification_queue"
        );
        $row = $statement->fetch() ?: [];
        return ['pending' => (int)($row['pending'] ?? 0), 'failed' => (int)($row['failed'] ?? 0), 'sent' => (int)($row['sent'] ?? 0)];
    }

    if ($name === 'get_hustle_score') {
        $targetId = (string)($args['p_user_id'] ?? $userId);
        if ($targetId !== $userId) require_admin($pdo, $config);
        $statement = $pdo->prepare(
            "SELECT
              (SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved') AS approved,
              (SELECT COUNT(*) FROM task_completions WHERE user_id = ?) AS total,
              (SELECT COUNT(*) FROM referrals WHERE referrer_id = ?) AS referrals,
              (SELECT streak FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1) AS streak"
        );
        $statement->execute([$targetId, $targetId, $targetId, $targetId]);
        $score = $statement->fetch();
        return min(100, min((int)$score['approved'], 40) + min((int)$score['referrals'], 20)
            + min((int)($score['streak'] ?? 0), 20) * 2 + ((int)$score['total'] > 0 ? 20 : 0));
    }

    if ($name === 'get_my_referral_profiles') {
        $statement = $pdo->prepare(
            'SELECT p.user_id AS referred_id, p.full_name, p.username, p.avatar_url, p.tier, p.joined_at,
                    r.created_at AS referral_created_at, r.bonus_paid
             FROM referrals r JOIN profiles p ON p.user_id = r.referred_id
             WHERE r.referrer_id = ? ORDER BY r.created_at DESC'
        );
        $statement->execute([$userId]);
        return $statement->fetchAll();
    }

    if ($name === 'get_leaderboard') {
        $category = (string)($args['p_category'] ?? 'earnings');
        if (!in_array($category, ['earnings', 'hustles', 'referrals'], true)) throw new InvalidArgumentException('Invalid leaderboard category.');
        $metric = match ($category) {
            'earnings' => 'COALESCE(b.total_earned, 0)',
            'hustles' => "(SELECT COUNT(*) FROM task_completions c WHERE c.user_id = p.user_id AND c.status = 'approved')",
            default => '(SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = p.user_id)',
        };
        $statement = $pdo->query(
            "SELECT p.user_id, p.full_name, p.username, p.avatar_url, p.public_activity_opt_in, p.leaderboard_opt_in,
                    {$metric} AS score
             FROM profiles p LEFT JOIN balances b ON b.user_id = p.user_id
             WHERE p.account_status = 'active' AND {$metric} > 0
             ORDER BY score DESC, p.user_id LIMIT 20"
        );
        $rows = $statement->fetchAll();
        foreach ($rows as $index => &$row) {
            $displayUserId = $row['user_id'];
            $row['position'] = $index + 1;
            $row['user_id'] = $isAdmin || (bool)$row['leaderboard_opt_in'] ? $row['user_id'] : null;
            $row['display_name'] = (bool)$row['public_activity_opt_in']
                ? (($row['full_name'] ?? '') !== '' ? $row['full_name'] : $row['username'])
                : 'Hustler ' . substr((string)$displayUserId, 0, 6);
            if (!(bool)$row['public_activity_opt_in']) $row['avatar_url'] = null;
            unset($row['full_name'], $row['username'], $row['public_activity_opt_in'], $row['leaderboard_opt_in']);
        }
        return $rows;
    }

    if ($name === 'record_user_activity') {
        $elapsed = filter_var($args['p_elapsed_seconds'] ?? null, FILTER_VALIDATE_INT);
        $interactions = filter_var($args['p_interactions'] ?? null, FILTER_VALIDATE_INT);
        if ($elapsed === false || $interactions === false || $elapsed < 0 || $elapsed > 120 || $interactions < 0 || $interactions > 50) {
            throw new InvalidArgumentException('Invalid activity batch.');
        }
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active'");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $pdo->beginTransaction();
        $pdo->prepare('INSERT IGNORE INTO user_activity_daily (user_id, activity_date) VALUES (?, UTC_DATE())')->execute([$userId]);
        $statement = $pdo->prepare(
            'SELECT online_seconds, interactions, paid_online_blocks, paid_interaction_blocks,
                    GREATEST(0, TIMESTAMPDIFF(SECOND, last_heartbeat_at, UTC_TIMESTAMP(3))) AS since_heartbeat
             FROM user_activity_daily WHERE user_id = ? AND activity_date = UTC_DATE() FOR UPDATE'
        );
        $statement->execute([$userId]);
        $activity = $statement->fetch();
        $recordedElapsed = min((int)$elapsed, min(120, (int)$activity['since_heartbeat']));
        $recordedInteractions = min((int)$interactions, intdiv($recordedElapsed, 2));
        $online = (int)$activity['online_seconds'] + $recordedElapsed;
        $totalInteractions = (int)$activity['interactions'] + $recordedInteractions;
        $onlineBlocks = intdiv($online, 1800);
        $interactionBlocks = intdiv($totalInteractions, 100);
        $reward = max(0, $onlineBlocks - (int)$activity['paid_online_blocks']) * 5
            + max(0, $interactionBlocks - (int)$activity['paid_interaction_blocks']) * 0.1;
        $pdo->prepare(
            'UPDATE user_activity_daily SET online_seconds = ?, interactions = ?, paid_online_blocks = ?,
             paid_interaction_blocks = ?, last_heartbeat_at = UTC_TIMESTAMP(3), last_activity_at = UTC_TIMESTAMP(3)
             WHERE user_id = ? AND activity_date = UTC_DATE()'
        )->execute([$online, $totalInteractions, $onlineBlocks, $interactionBlocks, $userId]);
        if ($reward > 0) {
            $pdo->prepare('SELECT user_id FROM balances WHERE user_id = ? FOR UPDATE')->execute([$userId]);
            $balanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ?');
            $balanceQuery->execute([$userId]);
            $before = (float)$balanceQuery->fetchColumn();
            $pdo->prepare('UPDATE balances SET reward_balance = reward_balance + ?, total_earned = total_earned + ? WHERE user_id = ?')
                ->execute([$reward, $reward, $userId]);
            record_wallet_ledger($pdo, uuid_v4(), $userId, $userId, 'reward', $reward, $before, $before + $reward, 'Verified site engagement reward');
        }
        $pdo->commit();
        return ['online_seconds' => $online, 'interactions' => $totalInteractions, 'reward' => $reward];
    }

    if ($name === 'claim_daily_checkin') {
        $pdo->beginTransaction();
        $profile = $pdo->prepare("SELECT user_id FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $profile->execute([$userId]);
        if (!$profile->fetch()) respond(['error' => 'This account is not active.'], 403);
        $lastQuery = $pdo->prepare('SELECT checkin_date, streak FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1 FOR UPDATE');
        $lastQuery->execute([$userId]);
        $last = $lastQuery->fetch();
        if ($last && $last['checkin_date'] === gmdate('Y-m-d')) respond(['error' => 'Your daily check-in is already claimed.'], 409);
        $streak = $last && $last['checkin_date'] === gmdate('Y-m-d', time() - 86400) ? (int)$last['streak'] + 1 : 1;
        $day = (($streak - 1) % 7) + 1;
        $reward = [1 => 50, 2 => 75, 3 => 100, 4 => 125, 5 => 150, 6 => 200, 7 => 350][$day];
        $balance = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $balance->execute([$userId]);
        $before = $balance->fetchColumn();
        if ($before === false) respond(['error' => 'Wallet not found.'], 404);
        $checkinId = uuid_v4();
        $pdo->prepare('INSERT INTO daily_checkins (id, user_id, checkin_date, streak, reward) VALUES (?, ?, UTC_DATE(), ?, ?)')
            ->execute([$checkinId, $userId, $streak, $reward]);
        $pdo->prepare('UPDATE balances SET reward_balance = reward_balance + ?, total_earned = total_earned + ? WHERE user_id = ?')
            ->execute([$reward, $reward, $userId]);
        record_wallet_ledger(
            $pdo,
            uuid_v4(),
            $userId,
            $userId,
            'reward',
            $reward,
            $before,
            (float)$before + $reward,
            'Daily hustle check-in day ' . $day
        );
        $pdo->commit();
        return ['id' => $checkinId, 'user_id' => $userId, 'checkin_date' => gmdate('Y-m-d'), 'streak' => $streak, 'reward' => $reward];
    }

    if ($name === 'claim_task') {
        $taskId = (string)($args['p_task_id'] ?? '');
        $proofText = trim((string)($args['p_proof_text'] ?? ''));
        $proofPath = isset($args['p_proof_path']) && $args['p_proof_path'] !== '' ? (string)$args['p_proof_path'] : null;
        if (strlen($proofText) > 2000) throw new InvalidArgumentException('Proof must be 2000 characters or fewer.');
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT user_id FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetch()) respond(['error' => 'This account is not active.'], 403);
        $taskQuery = $pdo->prepare(
            'SELECT * FROM tasks WHERE id = ? AND is_active = 1 AND is_funded = 1
             AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
             AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3)) FOR UPDATE'
        );
        $taskQuery->execute([$taskId]);
        $task = $taskQuery->fetch();
        if (!$task) respond(['error' => 'This hustle is unavailable.'], 404);
        if ($task['verification_mode'] === 'automatic') {
            respond(['error' => 'This hustle must be completed through its tracked verification link.'], 409);
        }
        if ($task['campaign_budget_remaining'] !== null) {
            $reservationQuery = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status = 'pending'");
            $reservationQuery->execute([$taskId]);
            if ((float)$task['campaign_budget_remaining'] < (float)$task['reward'] * ((int)$reservationQuery->fetchColumn() + 1)) {
                respond(['error' => 'Campaign funds are reserved for existing submissions.'], 409);
            }
        }
        if ((bool)$task['proof_required'] && $proofText === '' && $proofPath === null) respond(['error' => 'Proof is required for this hustle.'], 422);
        if ($proofPath !== null) {
            if (!str_starts_with($proofPath, $userId . '/') || strlen($proofPath) > 500) respond(['error' => 'Invalid proof upload path.'], 422);
            $proof = $pdo->prepare("SELECT id FROM storage_files WHERE bucket = 'task-proofs' AND object_path = ? AND owner_id = ?");
            $proof->execute([$proofPath, $userId]);
            if (!$proof->fetch()) respond(['error' => 'Proof upload was not found.'], 404);
        }

        $planQuery = $pdo->prepare(
            "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
             AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
             ORDER BY starts_at DESC LIMIT 1"
        );
        $planQuery->execute([$userId]);
        $planCode = $planQuery->fetchColumn() ?: 'free';
        $rankForPlan = static fn(string $code): int => match ($code) {
            'premium' => 1,
            'vip' => 2,
            'president' => 3,
            default => 0,
        };
        $plan = $pdo->prepare('SELECT daily_task_limit, daily_earning_cap FROM subscription_plans WHERE plan_code = ? AND is_active = 1');
        $plan->execute([$planCode]);
        $planSettings = $plan->fetch();
        $requiredPlan = $pdo->prepare('SELECT is_active FROM subscription_plans WHERE plan_code = ?');
        $requiredPlan->execute([$task['required_plan_code']]);
        if (!$requiredPlan->fetchColumn()) respond(['error' => 'This plan is not currently available.'], 409);
        if (!$planSettings || $rankForPlan($planCode) < $rankForPlan((string)$task['required_plan_code'])) {
            respond(['error' => 'This hustle requires the ' . ucfirst((string)$task['required_plan_code']) . ' plan.'], 403);
        }
        $featureQuery = $pdo->prepare("SELECT free_enabled, premium_enabled FROM feature_permissions WHERE feature_key = 'hustles'");
        $featureQuery->execute();
        $featureSettings = $featureQuery->fetch();
        if ($featureSettings && !(bool)$featureSettings[$planCode === 'free' ? 'free_enabled' : 'premium_enabled']) {
            respond(['error' => 'Hustles are not available for your plan.'], 403);
        }
        $daily = $pdo->prepare(
            "SELECT COUNT(*) AS completion_count, COALESCE(SUM(t.reward), 0) AS earned
             FROM task_completions c JOIN tasks t ON t.id = c.task_id
             WHERE c.user_id = ? AND c.status IN ('pending', 'approved') AND c.completed_at >= UTC_DATE()"
        );
        $daily->execute([$userId]);
        $dailyStats = $daily->fetch();
        if ((int)$dailyStats['completion_count'] >= (int)$planSettings['daily_task_limit']) {
            respond(['error' => 'You have reached the daily hustle limit for your plan.'], 409);
        }
        if ($planSettings['daily_earning_cap'] !== null && (float)$dailyStats['earned'] + (float)$task['reward'] > (float)$planSettings['daily_earning_cap']) {
            respond(['error' => 'You have reached the daily earning cap for your plan.'], 409);
        }
        if ((int)$task['daily_quota'] > 0) {
            $quota = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status IN ('pending', 'approved') AND completed_at >= UTC_DATE()");
            $quota->execute([$taskId]);
            if ((int)$quota->fetchColumn() >= (int)$task['daily_quota']) respond(['error' => 'The daily hustle quota has been reached.'], 409);
        }
        $existingQuery = $pdo->prepare('SELECT * FROM task_completions WHERE user_id = ? AND task_id = ? FOR UPDATE');
        $existingQuery->execute([$userId, $taskId]);
        $existing = $existingQuery->fetch();
        if ($existing && $existing['status'] !== 'rejected') respond(['error' => 'This hustle has already been submitted.'], 409);
        if ($existing) {
            $pdo->prepare(
                "UPDATE task_completions SET status = 'pending', proof_text = ?, proof_path = ?, review_note = NULL,
                 reviewed_at = NULL, reviewed_by = NULL, completed_at = UTC_TIMESTAMP(3) WHERE id = ?"
            )->execute([$proofText !== '' ? $proofText : null, $proofPath, $existing['id']]);
            $completionId = $existing['id'];
        } else {
            $completionId = uuid_v4();
            $pdo->prepare(
                "INSERT INTO task_completions (id, user_id, task_id, status, proof_text, proof_path)
                 VALUES (?, ?, ?, 'pending', ?, ?)"
            )->execute([$completionId, $userId, $taskId, $proofText !== '' ? $proofText : null, $proofPath]);
        }
        $reviewMode = (string)$pdo->query('SELECT auto_review_mode FROM platform_settings WHERE singleton = 1')->fetchColumn();
        if ($reviewMode === 'reject') {
            $pdo->prepare(
                "UPDATE task_completions SET status = 'rejected', review_note = 'Automatically rejected by platform settings',
                 reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?"
            )->execute([$completionId]);
            queue_task_review_email($pdo, $userId, $taskId, 'rejected', 'Automatically rejected by platform settings');
        } elseif ($reviewMode === 'approve') {
            $rewardBalanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $rewardBalanceQuery->execute([$userId]);
            $before = $rewardBalanceQuery->fetchColumn();
            if ($before === false) respond(['error' => 'User wallet not found.'], 404);
            $after = (float)$before + (float)$task['reward'];
            if ($after >= 10000000000) respond(['error' => 'Reward exceeds the wallet balance limit.'], 409);
            $pdo->prepare(
                "UPDATE task_completions SET status = 'approved', review_note = 'Automatically approved by platform settings',
                 reviewed_at = UTC_TIMESTAMP(3) WHERE id = ?"
            )->execute([$completionId]);
            $pdo->prepare('UPDATE balances SET reward_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
                ->execute([$after, $task['reward'], $userId]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                $userId,
                $userId,
                'reward',
                $task['reward'],
                $before,
                $after,
                'Automatically approved hustle submission ' . $completionId
            );
            award_referral_first_hustle_reward($pdo, $userId);
            $approvedCount = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved'");
            $approvedCount->execute([$userId]);
            award_milestone_rewards($pdo, $userId, 'hustles', (int)$approvedCount->fetchColumn());
            queue_task_review_email($pdo, $userId, $taskId, 'approved', null);
            if ($task['campaign_budget_remaining'] !== null) {
                $remaining = (float)$task['campaign_budget_remaining'] - (float)$task['reward'];
                $pdo->prepare('UPDATE tasks SET campaign_budget_remaining = ?, is_active = ? WHERE id = ?')
                    ->execute([$remaining, $remaining >= (float)$task['reward'] ? 1 : 0, $taskId]);
            }
        }
        $completion = $pdo->prepare('SELECT * FROM task_completions WHERE id = ?');
        $completion->execute([$completionId]);
        $result = $completion->fetch();
        $pdo->commit();
        return $result;
    }

    if ($name === 'submit_funding_deposit') {
        $amount = filter_var($args['p_amount'] ?? null, FILTER_VALIDATE_FLOAT);
        $method = (string)($args['p_payment_method'] ?? '');
        $proofText = trim((string)($args['p_proof_text'] ?? ''));
        $proofPath = isset($args['p_proof_path']) && $args['p_proof_path'] !== '' ? (string)$args['p_proof_path'] : null;
        if ($amount === false || $amount <= 0 || $amount >= 10000000000 || !in_array($method, ['paystack', 'flutterwave', 'manual'], true)) {
            throw new InvalidArgumentException('Enter a valid funding amount and payment method.');
        }
        $enabled = $pdo->query('SELECT enabled FROM funding_settings WHERE singleton = 1')->fetchColumn();
        if (!$enabled) respond(['error' => 'Wallet funding is currently disabled.'], 403);
        if ($method === 'manual' && strlen($proofText) < 5 && $proofPath === null) respond(['error' => 'Manual funding requires payment proof.'], 422);
        if (strlen($proofText) > 4000) throw new InvalidArgumentException('Payment proof is too long.');
        if ($proofPath !== null) {
            if (!str_starts_with($proofPath, $userId . '/') || strlen($proofPath) > 500) throw new InvalidArgumentException('Invalid proof upload path.');
            $proof = $pdo->prepare("SELECT id FROM storage_files WHERE bucket = 'funding-proofs' AND object_path = ? AND owner_id = ?");
            $proof->execute([$proofPath, $userId]);
            if (!$proof->fetch()) respond(['error' => 'Proof upload was not found.'], 404);
        }
        $id = uuid_v4();
        $reference = strtoupper($method) . '_FUND_' . strtoupper(bin2hex(random_bytes(16)));
        $pdo->prepare(
            'INSERT INTO funding_deposits (id, user_id, amount, payment_method, provider_reference, proof_text, proof_path)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([$id, $userId, $amount, $method, $reference, $proofText !== '' ? $proofText : null, $proofPath]);
        queue_email_notification($pdo, $userId, 'funding_submitted', [
            'amount' => (string)$amount,
            'payment_method' => $method,
        ]);
        $statement = $pdo->prepare('SELECT * FROM funding_deposits WHERE id = ?');
        $statement->execute([$id]);
        $deposit = $statement->fetch();
        if ($method === 'manual') return ['deposit' => $deposit, 'checkout_url' => null];
        $accountQuery = $pdo->prepare(
            'SELECT u.email, p.full_name FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?'
        );
        $accountQuery->execute([$userId]);
        $account = $accountQuery->fetch();
        if (!$account) respond(['error' => 'Account details were not found.'], 404);
        try {
            $checkoutUrl = initialize_gateway_checkout(
                $config,
                $method,
                (string)$account['email'],
                (string)$account['full_name'],
                (float)$amount,
                $reference,
                ['type' => 'funding_deposit', 'deposit_id' => $id, 'user_id' => $userId]
            );
        } catch (Throwable $error) {
            error_log('MrHustler funding checkout initialization failed: ' . $error->getMessage());
            $pdo->prepare("UPDATE funding_deposits SET status = 'expired', review_note = ? WHERE id = ?")
                ->execute([substr($error->getMessage(), 0, 500), $id]);
            respond(['error' => $error->getMessage()], 503);
        }
        return ['deposit' => $deposit, 'checkout_url' => $checkoutUrl];
    }

    if ($name === 'admin_review_funding_deposit') {
        require_admin($pdo, $config);
        $depositId = (string)($args['p_deposit_id'] ?? '');
        $decision = (string)($args['p_decision'] ?? '');
        if (!in_array($decision, ['confirm', 'reject'], true)) throw new InvalidArgumentException('Invalid funding decision.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT * FROM funding_deposits WHERE id = ? FOR UPDATE');
        $query->execute([$depositId]);
        $deposit = $query->fetch();
        if (!$deposit || $deposit['status'] !== 'pending') respond(['error' => 'Pending funding deposit not found.'], 404);
        $note = trim((string)($args['p_review_note'] ?? ''));
        if ($decision === 'confirm') {
            $balanceQuery = $pdo->prepare('SELECT fund_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $balanceQuery->execute([$deposit['user_id']]);
            $before = $balanceQuery->fetchColumn();
            if ($before === false) respond(['error' => 'User wallet not found.'], 404);
            $after = (float)$before + (float)$deposit['amount'];
            if ($after >= 10000000000) respond(['error' => 'Fund Wallet balance limit exceeded.'], 409);
            $pdo->prepare('UPDATE balances SET fund_balance = ? WHERE user_id = ?')
                ->execute([$after, $deposit['user_id']]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$deposit['user_id'],
                $userId,
                'fund',
                $deposit['amount'],
                $before,
                $after,
                'Confirmed wallet funding deposit ' . $depositId
            );
            $status = 'confirmed';
        } else {
            $status = 'rejected';
        }
        $pdo->prepare('UPDATE funding_deposits SET status = ?, review_note = ?, reviewed_at = UTC_TIMESTAMP(3), reviewed_by = ? WHERE id = ?')
            ->execute([$status, $note !== '' ? $note : null, $userId, $depositId]);
        queue_email_notification($pdo, (string)$deposit['user_id'], $status === 'confirmed' ? 'funding_confirmed' : 'funding_rejected', [
            'amount' => (string)$deposit['amount'],
            'review_note' => $note !== '' ? $note : 'Contact support for details.',
        ]);
        $pdo->commit();
        $statement = $pdo->prepare('SELECT * FROM funding_deposits WHERE id = ?');
        $statement->execute([$depositId]);
        return $statement->fetch();
    }

    if ($name === 'transfer_referral_balance') {
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT reward_balance, referral_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $query->execute([$userId]);
        $balance = $query->fetch();
        if (!$balance) respond(['error' => 'Wallet not found.'], 404);
        $amount = (float)$balance['referral_balance'];
        if ($amount <= 0) respond(['error' => 'No referral balance is available to transfer.'], 409);
        $pdo->prepare('UPDATE balances SET reward_balance = reward_balance + ?, referral_balance = 0 WHERE user_id = ?')
            ->execute([$amount, $userId]);
        record_wallet_ledger($pdo, uuid_v4(), $userId, $userId, 'referral', -$amount, $amount, 0, 'Transferred referral earnings to reward balance');
        record_wallet_ledger(
            $pdo,
            uuid_v4(),
            $userId,
            $userId,
            'reward',
            $amount,
            $balance['reward_balance'],
            (float)$balance['reward_balance'] + $amount,
            'Received transferred referral earnings'
        );
        $pdo->commit();
        $statement = $pdo->prepare('SELECT * FROM balances WHERE user_id = ?');
        $statement->execute([$userId]);
        return $statement->fetch();
    }

    if ($name === 'admin_review_task_completion') {
        require_admin($pdo, $config);
        $completionId = (string)($args['p_completion_id'] ?? '');
        $status = (string)($args['p_status'] ?? '');
        $note = trim((string)($args['p_review_note'] ?? ''));
        if (!in_array($status, ['approved', 'rejected'], true)) throw new InvalidArgumentException('Review status must be approved or rejected.');
        if (strlen($note) > 500) throw new InvalidArgumentException('Review note must be 500 characters or fewer.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT * FROM task_completions WHERE id = ? FOR UPDATE');
        $query->execute([$completionId]);
        $completion = $query->fetch();
        if (!$completion || $completion['status'] !== 'pending') respond(['error' => 'Pending task submission not found.'], 404);
        $pdo->prepare(
            'UPDATE task_completions SET status = ?, review_note = ?, reviewed_at = UTC_TIMESTAMP(3), reviewed_by = ? WHERE id = ?'
        )->execute([$status, $note !== '' ? $note : null, $userId, $completionId]);
        $auditDetails = json_encode([
            'completion_id' => $completionId,
            'task_id' => $completion['task_id'],
            'status' => $status,
            'note' => $note !== '' ? $note : null,
        ], JSON_THROW_ON_ERROR);
        $pdo->prepare(
            'INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)'
        )->execute([uuid_v4(), $userId, $completion['user_id'], 'task_submission_reviewed', $auditDetails]);

        if ($status === 'approved') {
            $taskQuery = $pdo->prepare('SELECT reward, campaign_budget_remaining FROM tasks WHERE id = ? FOR UPDATE');
            $taskQuery->execute([$completion['task_id']]);
            $task = $taskQuery->fetch();
            if (!$task) respond(['error' => 'The submitted hustle no longer exists.'], 404);
            $reward = $task['reward'];
            if ($task['campaign_budget_remaining'] !== null) {
                $reservations = $pdo->prepare(
                    "SELECT (SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status = 'pending')
                     + (SELECT COUNT(*) FROM task_verification_sessions WHERE task_id = ? AND status = 'started' AND expires_at > UTC_TIMESTAMP(3))"
                );
                $reservations->execute([$completion['task_id'], $completion['task_id']]);
                $required = (int)$reservations->fetchColumn();
                if ($required === 0) $required = 1;
                if ((float)$task['campaign_budget_remaining'] < (float)$reward * $required) {
                    respond(['error' => 'Campaign funds are reserved for active submissions.'], 409);
                }
            }
            $balanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $balanceQuery->execute([$completion['user_id']]);
            $before = $balanceQuery->fetchColumn();
            if ($before === false) respond(['error' => 'User wallet not found.'], 404);
            $after = (float)$before + (float)$reward;
            if ($after >= 10000000000) respond(['error' => 'Reward exceeds the wallet balance limit.'], 409);
            $pdo->prepare('UPDATE balances SET reward_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
                ->execute([$after, $reward, $completion['user_id']]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$completion['user_id'],
                $userId,
                'reward',
                $reward,
                $before,
                $after,
                'Approved task completion ' . $completionId
            );
            award_referral_first_hustle_reward($pdo, (string)$completion['user_id']);
            $approvedCount = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved'");
            $approvedCount->execute([$completion['user_id']]);
            award_milestone_rewards($pdo, (string)$completion['user_id'], 'hustles', (int)$approvedCount->fetchColumn());
            queue_task_review_email($pdo, (string)$completion['user_id'], (string)$completion['task_id'], 'approved', null);
            if ($task['campaign_budget_remaining'] !== null) {
                $remaining = (float)$task['campaign_budget_remaining'] - (float)$reward;
                $pdo->prepare('UPDATE tasks SET campaign_budget_remaining = ?, is_active = ? WHERE id = ?')
                    ->execute([$remaining, $remaining >= (float)$reward ? 1 : 0, $completion['task_id']]);
            }

            $referrerQuery = $pdo->prepare(
                "SELECT r.referrer_id FROM referrals r JOIN profiles p ON p.user_id = r.referrer_id
                 WHERE r.referred_id = ? AND p.account_status = 'active' FOR UPDATE"
            );
            $referrerQuery->execute([$completion['user_id']]);
            $referrerId = $referrerQuery->fetchColumn();
            if ($referrerId) {
                $planQuery = $pdo->prepare(
                    "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
                     AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
                     ORDER BY starts_at DESC LIMIT 1"
                );
                $planQuery->execute([$referrerId]);
                $referralPlan = $planQuery->fetchColumn() ?: 'free';
                $commissionQuery = $pdo->prepare('SELECT referral_commission_percent FROM subscription_plans WHERE plan_code = ? AND is_active = 1');
                $commissionQuery->execute([$referralPlan]);
                $commissionPercent = $commissionQuery->fetchColumn();
                $commission = round((float)$reward * (float)($commissionPercent ?: 0) / 100, 2);
                if ($commission > 0) {
                    $referralBalanceQuery = $pdo->prepare('SELECT referral_balance FROM balances WHERE user_id = ? FOR UPDATE');
                    $referralBalanceQuery->execute([$referrerId]);
                    $referralBefore = $referralBalanceQuery->fetchColumn();
                    if ($referralBefore === false) respond(['error' => 'Referrer wallet not found.'], 404);
                    $referralAfter = (float)$referralBefore + $commission;
                    if ($referralAfter >= 10000000000) respond(['error' => 'Referral commission exceeds the wallet balance limit.'], 409);
                    $pdo->prepare('UPDATE balances SET referral_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
                        ->execute([$referralAfter, $commission, $referrerId]);
                    record_wallet_ledger(
                        $pdo,
                        uuid_v4(),
                        (string)$referrerId,
                        $userId,
                        'referral',
                        $commission,
                        $referralBefore,
                        $referralAfter,
                        'Referral commission for task completion ' . $completionId
                    );
                }
            }
        } else {
            queue_task_review_email($pdo, (string)$completion['user_id'], (string)$completion['task_id'], 'rejected', $note);
        }
        $pdo->commit();
        return null;
    }

    if ($name === 'admin_review_withdrawal') {
        require_admin($pdo, $config);
        $withdrawalId = (string)($args['p_withdrawal_id'] ?? '');
        $status = (string)($args['p_status'] ?? '');
        $reference = trim((string)($args['p_transaction_reference'] ?? ''));
        if (!in_array($status, ['paid', 'rejected'], true)) throw new InvalidArgumentException('Status must be paid or rejected.');
        if ($status === 'paid' && $reference === '') throw new InvalidArgumentException('A transaction reference is required for payouts.');
        if (strlen($reference) > 150) throw new InvalidArgumentException('Transaction reference must be 150 characters or fewer.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT * FROM withdrawals WHERE id = ? FOR UPDATE');
        $query->execute([$withdrawalId]);
        $withdrawal = $query->fetch();
        if (!$withdrawal || $withdrawal['status'] !== 'pending') respond(['error' => 'Pending withdrawal not found.'], 404);
        if ($status === 'paid') {
            $balanceColumn = $withdrawal['wallet_type'] === 'referral' ? 'referral_balance' : 'reward_balance';
            $balanceQuery = $pdo->prepare("SELECT {$balanceColumn} FROM balances WHERE user_id = ? FOR UPDATE");
            $balanceQuery->execute([$withdrawal['user_id']]);
            $balance = $balanceQuery->fetchColumn();
            if ($balance === false) respond(['error' => 'User wallet not found.'], 404);
            $pendingQuery = $pdo->prepare(
                'SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE user_id = ? AND status = \'pending\'
                 AND wallet_type = ? AND id <> ?'
            );
            $pendingQuery->execute([$withdrawal['user_id'], $withdrawal['wallet_type'], $withdrawalId]);
            if ((float)$balance - (float)$pendingQuery->fetchColumn() < (float)$withdrawal['amount']) {
                respond(['error' => 'Wallet no longer covers this withdrawal and its existing requests.'], 409);
            }
            $after = (float)$balance - (float)$withdrawal['amount'];
            $pdo->prepare("UPDATE balances SET {$balanceColumn} = ? WHERE user_id = ?")->execute([$after, $withdrawal['user_id']]);
            $ledgerType = $withdrawal['wallet_type'] === 'referral' ? 'referral' : 'reward';
            $description = $withdrawal['wallet_type'] === 'referral' ? 'Paid referral withdrawal ' : 'Paid hustler withdrawal ';
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$withdrawal['user_id'],
                $userId,
                $ledgerType,
                -(float)$withdrawal['amount'],
                $balance,
                $after,
                $description . $withdrawalId
            );
        }
        $pdo->prepare(
            'UPDATE withdrawals SET status = ?, transaction_reference = ?, processed_at = UTC_TIMESTAMP(3), processed_by = ? WHERE id = ?'
        )->execute([$status, $reference !== '' ? $reference : null, $userId, $withdrawalId]);
        $auditDetails = json_encode([
            'withdrawal_id' => $withdrawalId,
            'status' => $status,
            'amount' => (string)$withdrawal['amount'],
            'reference' => $reference !== '' ? $reference : null,
        ], JSON_THROW_ON_ERROR);
        $pdo->prepare(
            'INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)'
        )->execute([uuid_v4(), $userId, $withdrawal['user_id'], 'withdrawal_reviewed', $auditDetails]);
        if ($status === 'paid') {
            queue_email_notification($pdo, (string)$withdrawal['user_id'], 'withdrawal_paid', [
                'amount' => (string)$withdrawal['amount'],
                'reference' => $reference !== '' ? $reference : 'Not provided',
            ]);
        } else {
            queue_email_notification($pdo, (string)$withdrawal['user_id'], 'withdrawal_rejected', [
                'amount' => (string)$withdrawal['amount'],
                'review_note' => 'Contact support for details.',
            ]);
        }
        $pdo->commit();
        $statement = $pdo->prepare('SELECT * FROM withdrawals WHERE id = ?');
        $statement->execute([$withdrawalId]);
        return $statement->fetch();
    }

    if ($name === 'admin_adjust_wallet') {
        require_admin($pdo, $config);
        $targetId = (string)($args['p_user_id'] ?? '');
        $balanceType = (string)($args['p_balance_type'] ?? '');
        $amount = filter_var($args['p_amount'] ?? null, FILTER_VALIDATE_FLOAT);
        $reason = trim((string)($args['p_reason'] ?? ''));
        if (!in_array($balanceType, ['reward', 'referral', 'fund'], true)) throw new InvalidArgumentException('Invalid balance type.');
        if ($amount === false || $amount == 0 || abs($amount) >= 10000000000) throw new InvalidArgumentException('Adjustment amount is out of range.');
        if (strlen($reason) < 1 || strlen($reason) > 500) throw new InvalidArgumentException('A reason of 1 to 500 characters is required.');
        $balanceColumn = match ($balanceType) {
            'reward' => 'reward_balance',
            'referral' => 'referral_balance',
            default => 'fund_balance',
        };
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT reward_balance, referral_balance, fund_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $query->execute([$targetId]);
        $balance = $query->fetch();
        if (!$balance) respond(['error' => 'User balance not found.'], 404);
        $before = (float)$balance[$balanceColumn];
        $after = $before + (float)$amount;
        if ($after < 0 || $after >= 10000000000) respond(['error' => 'Adjustment would put the balance out of range.'], 409);
        $pendingQuery = $pdo->prepare(
            "SELECT COALESCE(SUM(CASE WHEN wallet_type = 'hustler' THEN amount ELSE 0 END), 0) AS hustler_pending,
                    COALESCE(SUM(CASE WHEN wallet_type = 'referral' THEN amount ELSE 0 END), 0) AS referral_pending
             FROM withdrawals WHERE user_id = ? AND status = 'pending'"
        );
        $pendingQuery->execute([$targetId]);
        $pending = $pendingQuery->fetch();
        $rewardAfter = $balanceType === 'reward' ? $after : (float)$balance['reward_balance'];
        $referralAfter = $balanceType === 'referral' ? $after : (float)$balance['referral_balance'];
        if ($rewardAfter < (float)$pending['hustler_pending'] || $referralAfter < (float)$pending['referral_pending']) {
            respond(['error' => 'Adjustment would leave pending withdrawals unfunded.'], 409);
        }
        $pdo->prepare("UPDATE balances SET {$balanceColumn} = ? WHERE user_id = ?")->execute([$after, $targetId]);
        $ledgerId = uuid_v4();
        record_wallet_ledger($pdo, $ledgerId, $targetId, $userId, $balanceType, $amount, $before, $after, $reason);
        queue_email_notification($pdo, $targetId, 'wallet_adjusted', [
            'amount' => (string)$amount,
            'wallet_type' => $balanceType,
            'reason' => $reason,
        ]);
        $pdo->commit();
        return $ledgerId;
    }

    if ($name === 'admin_set_user_status') {
        require_admin($pdo, $config);
        $targetId = (string)($args['p_user_id'] ?? '');
        $status = (string)($args['p_status'] ?? '');
        $reason = trim((string)($args['p_reason'] ?? ''));
        if (!in_array($status, ['active', 'suspended', 'banned'], true)) throw new InvalidArgumentException('Invalid account status.');
        if ($targetId === $userId) throw new InvalidArgumentException('Administrators cannot change their own account status.');
        if (strlen($reason) > 500) throw new InvalidArgumentException('Reason must be 500 characters or fewer.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT account_status FROM profiles WHERE user_id = ? FOR UPDATE');
        $query->execute([$targetId]);
        $oldStatus = $query->fetchColumn();
        if ($oldStatus === false) respond(['error' => 'User profile not found.'], 404);
        $pdo->prepare(
            'UPDATE profiles SET account_status = ?, status_reason = ?, status_changed_at = UTC_TIMESTAMP(3), status_changed_by = ? WHERE user_id = ?'
        )->execute([$status, $reason !== '' ? $reason : null, $userId, $targetId]);
        $details = json_encode(['from' => $oldStatus, 'to' => $status, 'reason' => $reason !== '' ? $reason : null], JSON_THROW_ON_ERROR);
        $pdo->prepare(
            'INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)'
        )->execute([uuid_v4(), $userId, $targetId, 'user_status_changed', $details]);
        $pdo->commit();
        return null;
    }

    if ($name === 'request_withdrawal') {
        $amount = filter_var($args['p_amount'] ?? null, FILTER_VALIDATE_FLOAT);
        $bankName = trim((string)($args['p_bank_name'] ?? ''));
        $accountNumber = (string)($args['p_account_no'] ?? '');
        $accountName = trim((string)($args['p_account_name'] ?? ''));
        $walletType = (string)($args['p_wallet_type'] ?? 'hustler');
        if (!in_array($walletType, ['hustler', 'referral'], true)) throw new InvalidArgumentException('Invalid wallet type.');
        if ($amount === false || $amount <= 0 || $amount >= 10000000000 || round($amount, 2) != $amount) {
            throw new InvalidArgumentException('Enter a valid withdrawal amount.');
        }
        if (strlen($bankName) < 1 || strlen($bankName) > 100 || !preg_match('/^[0-9]{10}$/', $accountNumber)
            || strlen($accountName) < 1 || strlen($accountName) > 150) {
            throw new InvalidArgumentException('Enter valid bank and account details.');
        }
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $payout = $pdo->query('SELECT minimum_amount, enabled FROM payout_settings WHERE singleton = 1')->fetch();
        if (!$payout || !(bool)$payout['enabled']) respond(['error' => 'Withdrawals are currently disabled.'], 403);
        if ((float)$amount < (float)$payout['minimum_amount']) respond(['error' => 'Withdrawal does not meet the minimum amount.'], 422);
        $controls = $pdo->query('SELECT * FROM platform_settings WHERE singleton = 1')->fetch();
        $walletPrefix = $walletType === 'hustler' ? 'hustler' : 'referral';
        if (!$controls || !(bool)$controls[$walletPrefix . '_withdrawals_enabled']) {
            respond(['error' => $controls['withdrawal_failure_message'] ?? 'Withdrawals are currently disabled.'], 403);
        }
        $days = json_decode((string)$controls[$walletPrefix . '_payout_days'], true, 512, JSON_THROW_ON_ERROR);
        $timezoneName = (string)$controls[$walletPrefix . '_timezone'];
        try {
            $localNow = new DateTimeImmutable('now', new DateTimeZone($timezoneName));
        } catch (Throwable $error) {
            throw new RuntimeException('The payout timezone is invalid.', 0, $error);
        }
        $weekday = (int)$localNow->format('w');
        $startTime = substr((string)$controls[$walletPrefix . '_window_start'], 0, 8);
        $endTime = substr((string)$controls[$walletPrefix . '_window_end'], 0, 8);
        $currentTime = $localNow->format('H:i:s');
        if (!is_array($days) || !in_array($weekday, array_map('intval', $days), true) || $currentTime < $startTime || $currentTime > $endTime) {
            respond(['error' => $controls['withdrawal_failure_message'], 'next_payout_window' => true], 409);
        }
        $planQuery = $pdo->prepare(
            "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
             AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
             ORDER BY starts_at DESC LIMIT 1"
        );
        $planQuery->execute([$userId]);
        $planCode = $planQuery->fetchColumn() ?: 'free';
        $maxQuery = $pdo->prepare('SELECT max_withdrawal FROM subscription_plans WHERE plan_code = ?');
        $maxQuery->execute([$planCode]);
        $maxAmount = $maxQuery->fetchColumn();
        if ($maxAmount === false || (float)$amount > (float)$maxAmount) respond(['error' => 'This plan withdrawal limit has been exceeded.'], 422);
        $balanceQuery = $pdo->prepare('SELECT reward_balance, referral_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $balanceQuery->execute([$userId]);
        $balance = $balanceQuery->fetch();
        if (!$balance) respond(['error' => 'Wallet not found.'], 404);
        $walletColumn = $walletType === 'hustler' ? 'reward_balance' : 'referral_balance';
        $walletAmount = (float)$balance[$walletColumn];
        $pendingQuery = $pdo->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE user_id = ? AND status = 'pending' AND wallet_type = ?"
        );
        $pendingQuery->execute([$userId, $walletType]);
        $pending = (float)$pendingQuery->fetchColumn();
        $reservedQuery = $pdo->prepare(
            "SELECT COALESCE(SUM(wallet_contribution), 0) FROM user_subscriptions
             WHERE user_id = ? AND status = 'pending' AND expires_at > UTC_TIMESTAMP(3)"
        );
        $reservedQuery->execute([$userId]);
        $reserved = $walletType === 'hustler' ? (float)$reservedQuery->fetchColumn() : 0;
        if ($walletAmount - $pending - $reserved < $amount) respond(['error' => 'Insufficient available wallet balance.'], 409);
        $hustleCountQuery = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE user_id = ? AND status = 'approved'");
        $hustleCountQuery->execute([$userId]);
        $hustleCount = (int)$hustleCountQuery->fetchColumn();
        $level = match (true) {
            $hustleCount >= 1000 => 6,
            $hustleCount >= 500 => 5,
            $hustleCount >= 100 => 4,
            $hustleCount >= 50 => 3,
            $hustleCount >= 25 => 2,
            $hustleCount >= 10 => 1,
            default => 0,
        };
        $requirementsFailed = $hustleCount < (int)$controls['minimum_hustles'] || $level < (int)$controls['minimum_hustle_level'];
        if ((bool)$controls['require_all_hustles']) {
            $allHustles = $pdo->prepare(
                "SELECT COUNT(*) FROM tasks t WHERE t.is_active = 1 AND t.is_funded = 1
                 AND NOT EXISTS (SELECT 1 FROM task_completions c WHERE c.user_id = ? AND c.task_id = t.id AND c.status = 'approved')"
            );
            $allHustles->execute([$userId]);
            $requirementsFailed = $requirementsFailed || (int)$allHustles->fetchColumn() > 0;
        }
        $referralCount = $pdo->prepare('SELECT COUNT(*) FROM referrals WHERE referrer_id = ?');
        $referralCount->execute([$userId]);
        $requirementsFailed = $requirementsFailed || (int)$referralCount->fetchColumn() < (int)$controls['minimum_referrals'];
        $streakQuery = $pdo->prepare(
            'SELECT CASE WHEN checkin_date >= UTC_DATE() - INTERVAL 1 DAY THEN streak ELSE 0 END
             FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1'
        );
        $streakQuery->execute([$userId]);
        $requirementsFailed = $requirementsFailed || (int)($streakQuery->fetchColumn() ?: 0) < (int)$controls['minimum_checkin_streak'];
        $activityQuery = $pdo->prepare(
            'SELECT COALESCE(SUM(online_seconds) / 60, 0) AS online_minutes, COALESCE(SUM(interactions), 0) AS interactions
             FROM user_activity_daily WHERE user_id = ? AND activity_date >= UTC_DATE() - INTERVAL ? DAY'
        );
        $activityQuery->execute([$userId, max(0, (int)$controls['measurement_days'] - 1)]);
        $activity = $activityQuery->fetch();
        $requirementsFailed = $requirementsFailed || (float)$activity['online_minutes'] < (int)$controls['minimum_online_minutes']
            || (int)$activity['interactions'] < (int)$controls['minimum_interactions'];
        if ($requirementsFailed) {
            respond(['error' => $controls['withdrawal_failure_message']], 403);
        }
        $withdrawalId = uuid_v4();
        $pdo->prepare(
            'INSERT INTO withdrawals (id, user_id, amount, bank_name, account_no, account_name, wallet_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        )->execute([$withdrawalId, $userId, $amount, $bankName, $accountNumber, $accountName, $walletType]);
        queue_email_notification($pdo, $userId, 'withdrawal_requested', [
            'amount' => (string)$amount,
            'wallet_type' => $walletType,
            'status' => 'pending',
            'event_date' => gmdate('Y-m-d'),
        ]);
        $statement = $pdo->prepare('SELECT * FROM withdrawals WHERE id = ?');
        $statement->execute([$withdrawalId]);
        $withdrawal = $statement->fetch();
        $pdo->commit();
        return $withdrawal;
    }

    if ($name === 'submit_manual_plan_payment' || $name === 'submit_gateway_plan_payment') {
        $planCode = (string)($args['p_plan_code'] ?? '');
        $isManual = $name === 'submit_manual_plan_payment';
        $provider = $isManual ? 'manual' : (string)($args['p_provider'] ?? '');
        if (!$isManual && !in_array($provider, ['paystack', 'flutterwave'], true)) throw new InvalidArgumentException('Unsupported payment provider.');
        $proof = trim((string)($args['p_payment_proof'] ?? ''));
        if ($isManual && (strlen($proof) < 5 || strlen($proof) > 4000)) throw new InvalidArgumentException('Payment proof must contain 5 to 4000 characters.');
        $pdo->beginTransaction();
        $profile = $pdo->prepare("SELECT user_id FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $profile->execute([$userId]);
        if (!$profile->fetch()) respond(['error' => 'This account is not active.'], 403);
        $planQuery = $pdo->prepare('SELECT * FROM subscription_plans WHERE plan_code = ? AND is_active = 1 AND price > 0');
        $planQuery->execute([$planCode]);
        $plan = $planQuery->fetch();
        if (!$plan) respond(['error' => 'Paid plan is unavailable.'], 404);
        $activeQuery = $pdo->prepare(
            "SELECT id FROM user_subscriptions WHERE user_id = ? AND status = 'active'
             AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3)) LIMIT 1 FOR UPDATE"
        );
        $activeQuery->execute([$userId]);
        if ($activeQuery->fetch()) respond(['error' => 'An active paid plan already exists.'], 409);
        $pendingQuery = $pdo->prepare(
            "SELECT id FROM user_subscriptions WHERE user_id = ? AND status = 'pending'
             AND expires_at > UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE"
        );
        $pendingQuery->execute([$userId]);
        if ($pendingQuery->fetch()) respond(['error' => 'A plan payment is already awaiting review or confirmation.'], 409);
        $id = uuid_v4();
        $reference = strtoupper($provider) . '_' . strtoupper(bin2hex(random_bytes(16)));
        $expiry = $isManual ? 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY)' : 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE)';
        $insert = $pdo->prepare(
            "INSERT INTO user_subscriptions (id, user_id, plan_code, status, provider, provider_reference, amount, payment_method, payment_proof, expires_at)
             VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, {$expiry})"
        );
        $insert->execute([$id, $userId, $planCode, $provider, $reference, $plan['price'], $provider, $isManual ? $proof : null]);
        $statement = $pdo->prepare('SELECT * FROM user_subscriptions WHERE id = ?');
        $statement->execute([$id]);
        $result = $statement->fetch();
        $pdo->commit();
        if ($isManual) return ['subscription' => $result, 'checkout_url' => null];
        $accountQuery = $pdo->prepare('SELECT email FROM users WHERE id = ?');
        $accountQuery->execute([$userId]);
        $email = $accountQuery->fetchColumn();
        if (!$email) respond(['error' => 'Account email was not found.'], 404);
        $profileQuery = $pdo->prepare('SELECT full_name FROM profiles WHERE user_id = ?');
        $profileQuery->execute([$userId]);
        $fullName = (string)($profileQuery->fetchColumn() ?: 'Hustler');
        try {
            $checkoutUrl = initialize_gateway_checkout(
                $config,
                $provider,
                (string)$email,
                $fullName,
                (float)$plan['price'],
                $reference,
                ['type' => 'plan_subscription', 'subscription_id' => $id, 'user_id' => $userId, 'plan_code' => $planCode]
            );
        } catch (Throwable $error) {
            error_log('MrHustler plan checkout initialization failed: ' . $error->getMessage());
            $pdo->prepare("UPDATE user_subscriptions SET status = 'cancelled', expires_at = UTC_TIMESTAMP(3) WHERE id = ?")
                ->execute([$id]);
            respond(['error' => $error->getMessage()], 503);
        }
        return ['subscription' => $result, 'checkout_url' => $checkoutUrl];
    }

    if ($name === 'admin_review_plan_subscription') {
        require_admin($pdo, $config);
        $subscriptionId = (string)($args['p_subscription_id'] ?? '');
        $decision = (string)($args['p_decision'] ?? '');
        if (!in_array($decision, ['activate', 'decline'], true)) throw new InvalidArgumentException('Invalid subscription decision.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT * FROM user_subscriptions WHERE id = ? FOR UPDATE');
        $query->execute([$subscriptionId]);
        $subscription = $query->fetch();
        if (!$subscription || $subscription['status'] !== 'pending') respond(['error' => 'Pending subscription not found.'], 404);
        if ($decision === 'activate') {
            $activeQuery = $pdo->prepare(
                "SELECT id FROM user_subscriptions WHERE user_id = ? AND id <> ? AND status = 'active'
                 AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3)) LIMIT 1 FOR UPDATE"
            );
            $activeQuery->execute([$subscription['user_id'], $subscriptionId]);
            if ($activeQuery->fetch()) respond(['error' => 'User already has an active paid plan.'], 409);
            $pdo->prepare(
                "UPDATE user_subscriptions SET status = 'active', starts_at = UTC_TIMESTAMP(3),
                 ends_at = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 DAY), expires_at = NULL WHERE id = ?"
            )->execute([$subscriptionId]);
            queue_subscription_activated_email($pdo, (string)$subscription['user_id'], (string)$subscription['plan_code']);
        } else {
            $pdo->prepare("UPDATE user_subscriptions SET status = 'cancelled', expires_at = UTC_TIMESTAMP(3) WHERE id = ?")
                ->execute([$subscriptionId]);
        }
        $pdo->commit();
        return null;
    }

    if ($name === 'set_custom_referral_code') {
        $code = strtoupper(trim((string)($args['p_code'] ?? '')));
        if (!preg_match('/^[A-Z0-9]{4,16}$/', $code)) throw new InvalidArgumentException('Use 4-16 letters or numbers for your custom code.');
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active'");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $premium = $pdo->prepare(
            "SELECT 1 FROM user_subscriptions s JOIN subscription_plans p USING (plan_code)
             WHERE s.user_id = ? AND s.status = 'active' AND p.price > 0 AND s.starts_at <= UTC_TIMESTAMP(3)
               AND (s.ends_at IS NULL OR s.ends_at > UTC_TIMESTAMP(3)) LIMIT 1"
        );
        $premium->execute([$userId]);
        if (!$premium->fetchColumn()) respond(['error' => 'Custom referral codes are available to premium hustlers.'], 403);
        $feature = $pdo->prepare("SELECT premium_enabled FROM feature_permissions WHERE feature_key = 'custom-referral-code'");
        $feature->execute();
        $featureEnabled = $feature->fetchColumn();
        if ($featureEnabled !== false && !(bool)$featureEnabled) respond(['error' => 'Custom referral codes are not available for your plan.'], 403);
        $exists = $pdo->prepare('SELECT user_id FROM profiles WHERE referral_code = ? AND user_id <> ? LIMIT 1');
        $exists->execute([$code, $userId]);
        if ($exists->fetch()) respond(['error' => 'That referral code is already in use.'], 409);
        $pdo->prepare('UPDATE profiles SET referral_code = ? WHERE user_id = ?')->execute([$code, $userId]);
        return $code;
    }

    if ($name === 'transfer_earnings_to_user') {
        $recipient = trim((string)($args['p_recipient'] ?? ''));
        $amount = filter_var($args['p_amount'] ?? null, FILTER_VALIDATE_FLOAT);
        if ($amount === false || $amount <= 0 || $amount >= 10000000000 || round($amount, 2) != $amount) {
            throw new InvalidArgumentException('Enter a valid transfer amount.');
        }
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $premium = $pdo->prepare(
            "SELECT 1 FROM user_subscriptions s JOIN subscription_plans p USING (plan_code)
             WHERE s.user_id = ? AND s.status = 'active' AND p.price > 0 AND s.starts_at <= UTC_TIMESTAMP(3)
               AND (s.ends_at IS NULL OR s.ends_at > UTC_TIMESTAMP(3)) LIMIT 1"
        );
        $premium->execute([$userId]);
        if (!$premium->fetchColumn()) respond(['error' => 'Transfers are available to premium hustlers.'], 403);
        $feature = $pdo->prepare("SELECT premium_enabled FROM feature_permissions WHERE feature_key = 'transfers'");
        $feature->execute();
        $enabled = $feature->fetchColumn();
        if ($enabled !== false && !(bool)$enabled) respond(['error' => 'Transfers are not available for your plan.'], 403);
        $recipientQuery = $pdo->prepare(
            "SELECT user_id FROM profiles WHERE account_status = 'active'
             AND (LOWER(username) = LOWER(?) OR referral_code = UPPER(?)) LIMIT 1"
        );
        $recipientQuery->execute([$recipient, $recipient]);
        $recipientId = $recipientQuery->fetchColumn();
        if (!$recipientId) respond(['error' => 'No active hustler matches that username or referral code.'], 404);
        if ($recipientId === $userId) respond(['error' => 'Choose another hustler as the recipient.'], 422);
        $balancesQuery = $pdo->prepare('SELECT user_id, reward_balance FROM balances WHERE user_id IN (?, ?) ORDER BY user_id FOR UPDATE');
        $balancesQuery->execute([$userId, $recipientId]);
        $wallets = $balancesQuery->fetchAll();
        if (count($wallets) !== 2) respond(['error' => 'Sender or recipient wallet was not found.'], 404);
        $walletByUser = [];
        foreach ($wallets as $wallet) $walletByUser[$wallet['user_id']] = (float)$wallet['reward_balance'];
        $senderBefore = $walletByUser[$userId];
        $recipientBefore = $walletByUser[$recipientId];
        $pendingQuery = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE user_id = ? AND status = 'pending' AND wallet_type = 'hustler'");
        $pendingQuery->execute([$userId]);
        $reservedQuery = $pdo->prepare("SELECT COALESCE(SUM(wallet_contribution), 0) FROM user_subscriptions WHERE user_id = ? AND status = 'pending' AND expires_at > UTC_TIMESTAMP(3)");
        $reservedQuery->execute([$userId]);
        if ($senderBefore - (float)$pendingQuery->fetchColumn() - (float)$reservedQuery->fetchColumn() < $amount) {
            respond(['error' => 'Insufficient available Hustler Wallet balance.'], 409);
        }
        if ($recipientBefore + $amount >= 10000000000) respond(['error' => 'Recipient wallet balance limit would be exceeded.'], 409);
        $pdo->prepare('UPDATE balances SET reward_balance = reward_balance - ? WHERE user_id = ?')->execute([$amount, $userId]);
        $pdo->prepare('UPDATE balances SET reward_balance = reward_balance + ? WHERE user_id = ?')->execute([$amount, $recipientId]);
        record_wallet_ledger($pdo, uuid_v4(), $userId, $userId, 'reward', -$amount, $senderBefore, $senderBefore - $amount, 'Transfer to user ' . $recipientId);
        record_wallet_ledger(
            $pdo,
            uuid_v4(),
            (string)$recipientId,
            $userId,
            'reward',
            $amount,
            $recipientBefore,
            $recipientBefore + $amount,
            'Transfer from user ' . $userId
        );
        $statement = $pdo->prepare('SELECT * FROM balances WHERE user_id = ?');
        $statement->execute([$userId]);
        $result = $statement->fetch();
        $pdo->commit();
        return $result;
    }

    if ($name === 'submit_campaign') {
        $title = trim((string)($args['p_title'] ?? ''));
        $description = trim((string)($args['p_description'] ?? ''));
        $category = trim((string)($args['p_category'] ?? ''));
        $reward = filter_var($args['p_reward'] ?? null, FILTER_VALIDATE_FLOAT);
        $quantity = filter_var($args['p_quantity'] ?? null, FILTER_VALIDATE_INT);
        $taskUrl = trim((string)($args['p_task_url'] ?? ''));
        $proofInstructions = trim((string)($args['p_proof_instructions'] ?? ''));
        if (strlen($title) < 4 || strlen($title) > 120 || strlen($description) < 10 || strlen($description) > 2000
            || strlen($category) < 2 || strlen($category) > 80 || strlen($proofInstructions) < 5 || strlen($proofInstructions) > 1000
            || !filter_var($taskUrl, FILTER_VALIDATE_URL) || !preg_match('/^https?:\/\//i', $taskUrl)) {
            throw new InvalidArgumentException('Complete every campaign field with a valid URL.');
        }
        if ($reward === false || $reward <= 0 || $quantity === false || $quantity < 1 || $quantity > 1000) {
            throw new InvalidArgumentException('Enter a valid reward and quantity.');
        }
        $budget = round($reward * $quantity, 2);
        if ($budget >= 10000000000) throw new InvalidArgumentException('Campaign budget is too large.');
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $feature = $pdo->prepare('SELECT free_enabled, premium_enabled FROM feature_permissions WHERE feature_key = ?');
        $feature->execute(['campaigns']);
        $campaignFeature = $feature->fetch();
        $subscription = $pdo->prepare(
            "SELECT p.price FROM user_subscriptions s JOIN subscription_plans p USING (plan_code)
             WHERE s.user_id = ? AND s.status = 'active' AND s.starts_at <= UTC_TIMESTAMP(3)
               AND (s.ends_at IS NULL OR s.ends_at > UTC_TIMESTAMP(3)) ORDER BY s.starts_at DESC LIMIT 1"
        );
        $subscription->execute([$userId]);
        $isPremium = (float)($subscription->fetchColumn() ?: 0) > 0;
        if ($campaignFeature && !(bool)$campaignFeature[$isPremium ? 'premium_enabled' : 'free_enabled']) {
            respond(['error' => 'Campaign submissions are not available for your plan.'], 403);
        }
        $balanceQuery = $pdo->prepare('SELECT fund_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $balanceQuery->execute([$userId]);
        $fundBalance = $balanceQuery->fetchColumn();
        if ($fundBalance === false) respond(['error' => 'Fund Wallet not found.'], 404);
        $reservedQuery = $pdo->prepare("SELECT COALESCE(SUM(budget), 0) FROM campaign_submissions WHERE user_id = ? AND status = 'pending'");
        $reservedQuery->execute([$userId]);
        if ((float)$fundBalance - (float)$reservedQuery->fetchColumn() < $budget) respond(['error' => 'Insufficient available Fund Wallet balance.'], 409);
        $submissionId = uuid_v4();
        $pdo->prepare(
            'INSERT INTO campaign_submissions (id, user_id, title, description, category, reward, quantity, budget, task_url, proof_instructions)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )->execute([$submissionId, $userId, $title, $description, $category, $reward, $quantity, $budget, $taskUrl, $proofInstructions]);
        $statement = $pdo->prepare('SELECT * FROM campaign_submissions WHERE id = ?');
        $statement->execute([$submissionId]);
        $result = $statement->fetch();
        $pdo->commit();
        return $result;
    }

    if ($name === 'admin_review_campaign_submission') {
        require_admin($pdo, $config);
        $submissionId = (string)($args['p_submission_id'] ?? '');
        $decision = (string)($args['p_decision'] ?? '');
        $note = trim((string)($args['p_review_note'] ?? ''));
        if (!in_array($decision, ['approve', 'reject'], true)) throw new InvalidArgumentException('Invalid campaign decision.');
        if (strlen($note) > 500) throw new InvalidArgumentException('Review note is too long.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT * FROM campaign_submissions WHERE id = ? FOR UPDATE');
        $query->execute([$submissionId]);
        $submission = $query->fetch();
        if (!$submission || $submission['status'] !== 'pending') respond(['error' => 'Pending campaign submission not found.'], 404);
        $taskId = null;
        if ($decision === 'approve') {
            $balanceQuery = $pdo->prepare('SELECT fund_balance FROM balances WHERE user_id = ? FOR UPDATE');
            $balanceQuery->execute([$submission['user_id']]);
            $fundBefore = $balanceQuery->fetchColumn();
            if ($fundBefore === false || (float)$fundBefore < (float)$submission['budget']) {
                respond(['error' => 'Fund Wallet no longer covers this campaign.'], 409);
            }
            $fundAfter = (float)$fundBefore - (float)$submission['budget'];
            $pdo->prepare('UPDATE balances SET fund_balance = ? WHERE user_id = ?')->execute([$fundAfter, $submission['user_id']]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$submission['user_id'],
                $userId,
                'fund',
                -(float)$submission['budget'],
                $fundBefore,
                $fundAfter,
                'Campaign funding ' . $submissionId
            );
            $taskId = uuid_v4();
            $pdo->prepare(
                'INSERT INTO tasks (id, title, description, category, reward, difficulty, is_active, task_url, daily_quota,
                 proof_required, proof_instructions, sort_order, is_funded, required_plan_code, verification_mode,
                 campaign_budget_remaining, campaign_submission_id)
                 SELECT ?, ?, ?, ?, ?, \'Standard\', 1, ?, ?, 1, ?, COALESCE(MAX(sort_order), 0) + 1, 1, \'free\', \'manual\', ?, ?
                 FROM tasks'
            )->execute([
                $taskId, $submission['title'], $submission['description'], $submission['category'], $submission['reward'],
                $submission['task_url'], $submission['quantity'], $submission['proof_instructions'], $submission['budget'], $submissionId,
            ]);
        }
        $status = $decision === 'approve' ? 'approved' : 'rejected';
        $pdo->prepare(
            'UPDATE campaign_submissions SET status = ?, task_id = ?, review_note = ?, reviewed_at = UTC_TIMESTAMP(3), reviewed_by = ? WHERE id = ?'
        )->execute([$status, $taskId, $note !== '' ? $note : null, $userId, $submissionId]);
        $statement = $pdo->prepare('SELECT * FROM campaign_submissions WHERE id = ?');
        $statement->execute([$submissionId]);
        $result = $statement->fetch();
        $pdo->commit();
        return $result;
    }

    if ($name === 'claim_welcome_bonus') {
        $socialConfirmed = filter_var($args['p_social_confirmed'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $announcement = $pdo->query('SELECT * FROM platform_announcements WHERE singleton = 1 AND enabled = 1 FOR UPDATE')->fetch();
        if (!$announcement || (float)$announcement['welcome_bonus'] <= 0) respond(['error' => 'No welcome bonus is currently available.'], 409);
        $socialLinks = json_decode((string)$announcement['social_links'], true, 512, JSON_THROW_ON_ERROR);
        if ((bool)$announcement['require_social'] && (!$socialConfirmed || !is_array($socialLinks) || count($socialLinks) === 0)) {
            respond(['error' => 'Join the official social channels and confirm before claiming.'], 422);
        }
        $claim = $pdo->prepare('INSERT IGNORE INTO welcome_bonus_claims (user_id, amount) VALUES (?, ?)');
        $claim->execute([$userId, $announcement['welcome_bonus']]);
        if ($claim->rowCount() === 0) respond(['error' => 'Welcome bonus has already been claimed.'], 409);
        $balanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $balanceQuery->execute([$userId]);
        $before = $balanceQuery->fetchColumn();
        if ($before === false) respond(['error' => 'Wallet not found.'], 404);
        $after = (float)$before + (float)$announcement['welcome_bonus'];
        if ($after >= 10000000000) respond(['error' => 'Welcome bonus exceeds the wallet balance limit.'], 409);
        $pdo->prepare('UPDATE balances SET reward_balance = ?, total_earned = total_earned + ? WHERE user_id = ?')
            ->execute([$after, $announcement['welcome_bonus'], $userId]);
        record_wallet_ledger($pdo, uuid_v4(), $userId, $userId, 'reward', $announcement['welcome_bonus'], $before, $after, 'Welcome bonus claim');
        $pdo->commit();
        return (float)$announcement['welcome_bonus'];
    }

    if ($name === 'start_task_verification') {
        $taskId = (string)($args['p_task_id'] ?? '');
        $pdo->beginTransaction();
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active' FOR UPDATE");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $taskQuery = $pdo->prepare(
            "SELECT * FROM tasks WHERE id = ? AND is_active = 1 AND is_funded = 1 AND verification_mode = 'automatic'
             AND task_url <> '' AND (campaign_budget_remaining IS NULL OR campaign_budget_remaining >= reward)
             AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3)) FOR UPDATE"
        );
        $taskQuery->execute([$taskId]);
        $task = $taskQuery->fetch();
        if (!$task) respond(['error' => 'This hustle is not available for automatic tracking.'], 404);
        $planQuery = $pdo->prepare(
            "SELECT plan_code FROM user_subscriptions WHERE user_id = ? AND status = 'active'
             AND starts_at <= UTC_TIMESTAMP(3) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
             ORDER BY starts_at DESC LIMIT 1"
        );
        $planQuery->execute([$userId]);
        $planCode = $planQuery->fetchColumn() ?: 'free';
        $rank = static fn(string $code): int => match ($code) {
            'premium' => 1,
            'vip' => 2,
            'president' => 3,
            default => 0,
        };
        $planQuery = $pdo->prepare('SELECT daily_task_limit, daily_earning_cap FROM subscription_plans WHERE plan_code = ? AND is_active = 1');
        $planQuery->execute([$planCode]);
        $plan = $planQuery->fetch();
        if (!$plan || $rank($planCode) < $rank((string)$task['required_plan_code'])) respond(['error' => 'This hustle requires a higher plan.'], 403);
        $feature = $pdo->prepare("SELECT free_enabled, premium_enabled FROM feature_permissions WHERE feature_key = 'hustles'");
        $feature->execute();
        $featureRow = $feature->fetch();
        $isPremium = $planCode !== 'free';
        if ($featureRow && !(bool)$featureRow[$isPremium ? 'premium_enabled' : 'free_enabled']) respond(['error' => 'Hustles are not available for your plan.'], 403);
        $daily = $pdo->prepare(
            "SELECT COUNT(*) AS completion_count, COALESCE(SUM(t.reward), 0) AS earned
             FROM task_completions c JOIN tasks t ON t.id = c.task_id
             WHERE c.user_id = ? AND c.status IN ('pending', 'approved') AND c.completed_at >= UTC_DATE()"
        );
        $daily->execute([$userId]);
        $dailyStats = $daily->fetch();
        if ((int)$dailyStats['completion_count'] >= (int)$plan['daily_task_limit']) respond(['error' => 'You have reached the daily hustle limit for your plan.'], 409);
        if ($plan['daily_earning_cap'] !== null && (float)$dailyStats['earned'] + (float)$task['reward'] > (float)$plan['daily_earning_cap']) {
            respond(['error' => 'You have reached the daily earning cap for your plan.'], 409);
        }
        if ((int)$task['daily_quota'] > 0) {
            $quota = $pdo->prepare("SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status IN ('pending', 'approved') AND completed_at >= UTC_DATE()");
            $quota->execute([$taskId]);
            if ((int)$quota->fetchColumn() >= (int)$task['daily_quota']) respond(['error' => 'The daily hustle quota has been reached.'], 409);
        }
        $existing = $pdo->prepare("SELECT status FROM task_completions WHERE user_id = ? AND task_id = ? AND status IN ('pending', 'approved') LIMIT 1");
        $existing->execute([$userId, $taskId]);
        if ($existing->fetchColumn()) respond(['error' => 'This hustle has already been submitted.'], 409);
        $reservationQuery = $pdo->prepare(
            "SELECT (SELECT COUNT(*) FROM task_completions WHERE task_id = ? AND status = 'pending')
              + (SELECT COUNT(*) FROM task_verification_sessions WHERE task_id = ? AND status = 'started' AND expires_at > UTC_TIMESTAMP(3))"
        );
        $reservationQuery->execute([$taskId, $taskId]);
        if ($task['campaign_budget_remaining'] !== null
            && (float)$task['campaign_budget_remaining'] < (float)$task['reward'] * ((int)$reservationQuery->fetchColumn() + 1)) {
            respond(['error' => 'Campaign funds are reserved for active submissions.'], 409);
        }
        $pdo->prepare("UPDATE task_verification_sessions SET status = 'expired' WHERE user_id = ? AND task_id = ? AND status = 'started'")
            ->execute([$userId, $taskId]);
        $sessionId = uuid_v4();
        $pdo->prepare(
            "INSERT INTO task_verification_sessions (id, user_id, task_id, status, expires_at)
             VALUES (?, ?, ?, 'started', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))"
        )->execute([$sessionId, $userId, $taskId]);
        $statement = $pdo->prepare('SELECT * FROM task_verification_sessions WHERE id = ?');
        $statement->execute([$sessionId]);
        $result = $statement->fetch();
        $pdo->commit();
        return $result;
    }

    if ($name === 'admin_shuffle_tasks') {
        require_admin($pdo, $config);
        $category = isset($args['p_category']) && $args['p_category'] !== '' ? (string)$args['p_category'] : null;
        if ($category === null) {
            $taskIds = $pdo->query('SELECT id FROM tasks')->fetchAll(PDO::FETCH_COLUMN);
        } else {
            $query = $pdo->prepare('SELECT id FROM tasks WHERE category = ?');
            $query->execute([$category]);
            $taskIds = $query->fetchAll(PDO::FETCH_COLUMN);
        }
        shuffle($taskIds);
        $pdo->beginTransaction();
        $update = $pdo->prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
        foreach ($taskIds as $index => $taskId) $update->execute([$index + 1, $taskId]);
        $details = json_encode(['category' => $category, 'count' => count($taskIds)], JSON_THROW_ON_ERROR);
        $pdo->prepare('INSERT INTO admin_activity_log (id, actor_id, action, details) VALUES (?, ?, ?, ?)')
            ->execute([uuid_v4(), $userId, 'task_catalog_shuffled', $details]);
        $pdo->commit();
        return count($taskIds);
    }

    if ($name === 'admin_reorder_tasks') {
        require_admin($pdo, $config);
        $taskIds = $args['p_task_ids'] ?? null;
        if (!is_array($taskIds) || count($taskIds) === 0) {
            throw new InvalidArgumentException('The reorder list must include every hustle exactly once.');
        }
        $provided = [];
        foreach ($taskIds as $taskId) {
            if (!is_string($taskId) || !preg_match('/^[a-f0-9-]{36}$/i', $taskId)) {
                throw new InvalidArgumentException('The reorder list contains an invalid hustle ID.');
            }
            $provided[] = $taskId;
        }
        if (count($provided) !== count(array_unique($provided))) {
            throw new InvalidArgumentException('The reorder list must include every hustle exactly once.');
        }
        $allIds = array_map('strval', $pdo->query('SELECT id FROM tasks')->fetchAll(PDO::FETCH_COLUMN));
        sort($allIds);
        $sortedProvided = $provided;
        sort($sortedProvided);
        if ($allIds !== $sortedProvided) throw new InvalidArgumentException('The reorder list must include every hustle exactly once.');
        $pdo->beginTransaction();
        $update = $pdo->prepare('UPDATE tasks SET sort_order = ? WHERE id = ?');
        foreach ($provided as $index => $taskId) $update->execute([$index + 1, $taskId]);
        $pdo->commit();
        return count($provided);
    }

    if ($name === 'admin_fraud_flags') {
        require_admin($pdo, $config);
        $ipFlags = $pdo->query(
            "SELECT DISTINCT l.user_id, CONCAT('Shared IP: ', l.ip_address) AS flag, shared.account_count AS matched_accounts
             FROM user_login_history l
             JOIN (
               SELECT ip_address, COUNT(DISTINCT user_id) AS account_count
               FROM user_login_history WHERE ip_address IS NOT NULL AND TRIM(ip_address) <> ''
               GROUP BY ip_address HAVING COUNT(DISTINCT user_id) > 3
             ) shared ON shared.ip_address = l.ip_address"
        )->fetchAll();
        $identityFlags = $pdo->query(
            "WITH identity_keys AS (
               SELECT p.user_id, CONCAT('email:', LEFT(REGEXP_REPLACE(LOWER(SUBSTRING_INDEX(u.email, '@', 1)), '[^a-z]', ''), 5)) AS identity_key
               FROM profiles p JOIN users u ON u.id = p.user_id
               WHERE CHAR_LENGTH(REGEXP_REPLACE(LOWER(SUBSTRING_INDEX(u.email, '@', 1)), '[^a-z]', '')) >= 5
               UNION ALL
               SELECT user_id, CONCAT('username:', LEFT(REGEXP_REPLACE(LOWER(username), '[^a-z]', ''), 5))
               FROM profiles WHERE CHAR_LENGTH(REGEXP_REPLACE(LOWER(username), '[^a-z]', '')) >= 5
             ), matched AS (
               SELECT identity_key, COUNT(DISTINCT user_id) AS account_count FROM identity_keys
               GROUP BY identity_key HAVING COUNT(DISTINCT user_id) >= 10
             )
             SELECT DISTINCT i.user_id, 'Similar account name' AS flag, m.account_count AS matched_accounts
             FROM identity_keys i JOIN matched m ON m.identity_key = i.identity_key"
        )->fetchAll();
        return array_merge($ipFlags, $identityFlags);
    }

    if ($name === 'admin_issue_leaderboard_rewards') {
        require_admin($pdo, $config);
        $category = (string)($args['p_category'] ?? '');
        if (!in_array($category, ['earnings', 'hustles', 'referrals'], true)) throw new InvalidArgumentException('Invalid leaderboard category.');
        $periodValue = (string)($args['p_period_start'] ?? gmdate('Y-m-d'));
        $period = DateTimeImmutable::createFromFormat('!Y-m-d', $periodValue, new DateTimeZone('UTC'));
        if (!$period || $period->format('Y-m-d') !== $periodValue) throw new InvalidArgumentException('Invalid reward period.');
        $periodStart = $period->modify('first day of this month')->format('Y-m-d');
        $metric = match ($category) {
            'earnings' => 'COALESCE(b.total_earned, 0)',
            'hustles' => "(SELECT COUNT(*) FROM task_completions c WHERE c.user_id = p.user_id AND c.status = 'approved')",
            default => '(SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = p.user_id)',
        };
        $leaders = $pdo->query(
            "SELECT p.user_id, {$metric} AS score FROM profiles p LEFT JOIN balances b ON b.user_id = p.user_id
             WHERE p.account_status = 'active' AND {$metric} > 0 ORDER BY score DESC, p.user_id LIMIT 20"
        )->fetchAll();
        $pdo->beginTransaction();
        $rewardQuery = $pdo->prepare('SELECT amount FROM leaderboard_reward_settings WHERE `rank` = ? AND enabled = 1');
        $insertRun = $pdo->prepare(
            'INSERT IGNORE INTO leaderboard_reward_runs (id, period_start, category, user_id, `rank`, amount, issued_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $balanceQuery = $pdo->prepare('SELECT reward_balance FROM balances WHERE user_id = ? FOR UPDATE');
        $updateBalance = $pdo->prepare('UPDATE balances SET reward_balance = reward_balance + ?, total_earned = total_earned + ? WHERE user_id = ?');
        $issued = 0;
        foreach ($leaders as $index => $leader) {
            $rankPosition = $index + 1;
            $rewardQuery->execute([$rankPosition]);
            $reward = $rewardQuery->fetchColumn();
            if ($reward === false || (float)$reward <= 0) continue;
            $insertRun->execute([uuid_v4(), $periodStart, $category, $leader['user_id'], $rankPosition, $reward, $userId]);
            if ($insertRun->rowCount() === 0) continue;
            $balanceQuery->execute([$leader['user_id']]);
            $before = $balanceQuery->fetchColumn();
            if ($before === false) respond(['error' => 'Leaderboard winner wallet not found.'], 409);
            $after = (float)$before + (float)$reward;
            if ($after >= 10000000000) respond(['error' => 'Leaderboard reward exceeds the wallet balance limit.'], 409);
            $updateBalance->execute([$reward, $reward, $leader['user_id']]);
            record_wallet_ledger(
                $pdo,
                uuid_v4(),
                (string)$leader['user_id'],
                $userId,
                'reward',
                $reward,
                $before,
                $after,
                "Leaderboard rank {$rankPosition} reward for {$category} - {$periodStart}"
            );
            $issued++;
        }
        $pdo->commit();
        return $issued;
    }

    if ($name === 'admin_set_auto_review_mode') {
        require_admin($pdo, $config);
        $mode = (string)($args['p_mode'] ?? '');
        if (!in_array($mode, ['manual', 'approve', 'reject'], true)) throw new InvalidArgumentException('Invalid review mode.');
        $pdo->prepare('UPDATE platform_settings SET auto_review_mode = ?, updated_by = ? WHERE singleton = 1')
            ->execute([$mode, $userId]);
        if ($mode === 'manual') return 0;
        $pending = $pdo->query("SELECT id FROM task_completions WHERE status = 'pending' ORDER BY completed_at")->fetchAll(PDO::FETCH_COLUMN);
        $reviewed = 0;
        foreach ($pending as $completionId) {
            execute_rpc_request($pdo, $config, 'admin_review_task_completion', [
                'p_completion_id' => $completionId,
                'p_status' => $mode === 'approve' ? 'approved' : 'rejected',
                'p_review_note' => 'Reviewed by global ' . $mode . ' setting',
            ]);
            $reviewed++;
        }
        return $reviewed;
    }

    if ($name === 'admin_preview_historical_cleanup') {
        require_admin($pdo, $config);
        $cutoff = (string)($args['p_before'] ?? '');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $cutoff, new DateTimeZone('UTC'));
        if (!$date || $date->format('Y-m-d') !== $cutoff || $cutoff >= gmdate('Y-m-d')) {
            throw new InvalidArgumentException('Choose a past cutoff date.');
        }
        $statement = $pdo->prepare(
            "SELECT
               (SELECT COUNT(*) FROM task_completions WHERE status IN ('approved', 'rejected') AND completed_at < ?) AS hustles,
               (SELECT COUNT(*) FROM withdrawals WHERE status IN ('paid', 'rejected') AND requested_at < ?) AS withdrawals,
               ((SELECT COUNT(*) FROM wallet_ledger WHERE created_at < ?)
                 + (SELECT COUNT(*) FROM funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < ?)) AS transactions,
               (SELECT COUNT(*) FROM task_completions WHERE status IN ('approved', 'rejected') AND completed_at < ? AND proof_path IS NOT NULL) AS task_proofs,
               (SELECT COUNT(*) FROM funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < ? AND proof_path IS NOT NULL) AS funding_proofs,
               (SELECT COALESCE(SUM(sf.byte_size), 0) FROM storage_files sf JOIN task_completions c
                 ON sf.bucket = 'task-proofs' AND sf.object_path = c.proof_path
                 WHERE c.status IN ('approved', 'rejected') AND c.completed_at < ?)
               + (SELECT COALESCE(SUM(sf.byte_size), 0) FROM storage_files sf JOIN funding_deposits d
                 ON sf.bucket = 'funding-proofs' AND sf.object_path = d.proof_path
                 WHERE d.status IN ('confirmed', 'rejected', 'expired') AND d.created_at < ?) AS proof_bytes"
        );
        $statement->execute([$cutoff, $cutoff, $cutoff, $cutoff, $cutoff, $cutoff, $cutoff, $cutoff]);
        $result = $statement->fetch() ?: [];
        foreach ($result as $key => $value) $result[$key] = (int)$value;
        return $result;
    }

    if ($name === 'admin_purge_historical_records') {
        require_admin($pdo, $config);
        $cutoff = (string)($args['p_before'] ?? '');
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $cutoff, new DateTimeZone('UTC'));
        if (!$date || $date->format('Y-m-d') !== $cutoff || $cutoff >= gmdate('Y-m-d')) {
            throw new InvalidArgumentException('Choose a past cutoff date.');
        }
        $purgeHustles = filter_var($args['p_hustles'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $purgeWithdrawals = filter_var($args['p_withdrawals'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $purgeTransactions = filter_var($args['p_transactions'] ?? false, FILTER_VALIDATE_BOOLEAN);
        if (!$purgeHustles && !$purgeWithdrawals && !$purgeTransactions) {
            throw new InvalidArgumentException('Select at least one data category.');
        }
        $deleted = ['hustles' => 0, 'withdrawals' => 0, 'wallet_ledger' => 0, 'funding_deposits' => 0];
        $pdo->beginTransaction();
        if ($purgeHustles) {
            $delete = $pdo->prepare("DELETE FROM task_completions WHERE status IN ('approved', 'rejected') AND completed_at < ?");
            $delete->execute([$cutoff]);
            $deleted['hustles'] = $delete->rowCount();
        }
        if ($purgeWithdrawals) {
            $delete = $pdo->prepare("DELETE FROM withdrawals WHERE status IN ('paid', 'rejected') AND requested_at < ?");
            $delete->execute([$cutoff]);
            $deleted['withdrawals'] = $delete->rowCount();
        }
        if ($purgeTransactions) {
            $delete = $pdo->prepare('DELETE FROM wallet_ledger WHERE created_at < ?');
            $delete->execute([$cutoff]);
            $deleted['wallet_ledger'] = $delete->rowCount();
            $delete = $pdo->prepare("DELETE FROM funding_deposits WHERE status IN ('confirmed', 'rejected', 'expired') AND created_at < ?");
            $delete->execute([$cutoff]);
            $deleted['funding_deposits'] = $delete->rowCount();
        }
        $details = json_encode([
            'cutoff_date' => $cutoff,
            'hustles_deleted' => $deleted['hustles'],
            'withdrawals_deleted' => $deleted['withdrawals'],
            'wallet_ledger_deleted' => $deleted['wallet_ledger'],
            'funding_deposits_deleted' => $deleted['funding_deposits'],
        ], JSON_THROW_ON_ERROR);
        $pdo->prepare(
            'INSERT INTO admin_activity_log (id, actor_id, action, details) VALUES (?, ?, ?, ?)'
        )->execute([uuid_v4(), $userId, 'historical_data_cleanup', $details]);
        $pdo->commit();
        return $deleted;
    }

    if ($name === 'admin_dashboard_metrics') {
        require_admin($pdo, $config);
        $metrics = $pdo->query(
            "SELECT
               (SELECT COUNT(*) FROM funding_deposits WHERE status = 'pending') AS pending_deposits,
               (SELECT COALESCE(SUM(amount), 0) FROM funding_deposits WHERE status = 'confirmed') AS approved_deposits,
               (SELECT COUNT(*) FROM tasks WHERE is_active = 1 AND is_funded = 1) AS active_campaigns,
               (SELECT COUNT(DISTINCT user_id) FROM user_activity_daily WHERE last_activity_at > UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE) AS users_online,
               (SELECT COUNT(*) FROM profiles WHERE joined_at >= UTC_DATE()) AS registrations_today,
               (SELECT COUNT(*) FROM referrals WHERE created_at >= UTC_DATE()) AS referrals_today,
               (SELECT COUNT(*) FROM withdrawals w WHERE w.status = 'pending' AND w.user_id IN (
                 SELECT DISTINCT l.user_id
                 FROM user_login_history l
                 JOIN (
                   SELECT ip_address FROM user_login_history
                   WHERE ip_address IS NOT NULL AND TRIM(ip_address) <> ''
                   GROUP BY ip_address HAVING COUNT(DISTINCT user_id) > 3
                 ) shared_ips ON shared_ips.ip_address = l.ip_address
               )) AS flagged_withdrawals,
               (SELECT COALESCE(SUM(byte_size), 0) FROM storage_files) AS storage_bytes"
        )->fetch() ?: [];
        foreach ($metrics as $key => $value) $metrics[$key] = is_numeric($value) ? (str_contains((string)$value, '.') ? (float)$value : (int)$value) : $value;
        return $metrics;
    }

    if ($name === 'admin_user_details') {
        require_admin($pdo, $config);
        $targetId = (string)($args['p_user_id'] ?? '');
        $query = $pdo->prepare(
            'SELECT p.user_id, p.username, p.full_name, p.phone, p.joined_at, p.account_status, u.email
             FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?'
        );
        $query->execute([$targetId]);
        $profile = $query->fetch();
        if (!$profile) respond(['error' => 'User was not found.'], 404);
        $history = $pdo->prepare('SELECT ip_address, user_agent, created_at FROM user_login_history WHERE user_id = ? ORDER BY created_at DESC');
        $history->execute([$targetId]);
        $profile['login_history'] = $history->fetchAll();
        $referrals = $pdo->prepare(
            'SELECT p.username, p.joined_at, p.user_id FROM referrals r JOIN profiles p ON p.user_id = r.referred_id
             WHERE r.referrer_id = ? ORDER BY p.joined_at DESC'
        );
        $referrals->execute([$targetId]);
        $profile['referred_users'] = $referrals->fetchAll();
        $ipMatches = $pdo->prepare(
            'SELECT DISTINCT other.user_id, other.username, other_ip.ip_address
             FROM user_login_history own_ip
             JOIN user_login_history other_ip ON other_ip.ip_address = own_ip.ip_address AND other_ip.user_id <> own_ip.user_id
             JOIN profiles other ON other.user_id = other_ip.user_id
             WHERE own_ip.user_id = ? AND own_ip.ip_address IS NOT NULL'
        );
        $ipMatches->execute([$targetId]);
        $profile['ip_matches'] = $ipMatches->fetchAll();
        return $profile;
    }

    if ($name === 'admin_set_task_verification_mode') {
        require_admin($pdo, $config);
        $taskId = (string)($args['p_task_id'] ?? '');
        $mode = (string)($args['p_mode'] ?? '');
        if (!in_array($mode, ['manual', 'automatic'], true)) throw new InvalidArgumentException('Invalid verification mode.');
        $query = $pdo->prepare('SELECT task_url FROM tasks WHERE id = ?');
        $query->execute([$taskId]);
        $taskUrl = $query->fetchColumn();
        if ($taskUrl === false) respond(['error' => 'Hustle not found.'], 404);
        if ($mode === 'automatic' && (!filter_var($taskUrl, FILTER_VALIDATE_URL) || !preg_match('/^https?:\/\//i', (string)$taskUrl))) {
            respond(['error' => 'Automatic verification requires a valid HTTP or HTTPS task link.'], 422);
        }
        $pdo->prepare('UPDATE tasks SET verification_mode = ? WHERE id = ?')->execute([$mode, $taskId]);
        return null;
    }

    if (in_array($name, ['create_support_conversation', 'submit_support_ticket'], true)) {
        $active = $pdo->prepare("SELECT 1 FROM profiles WHERE user_id = ? AND account_status = 'active'");
        $active->execute([$userId]);
        if (!$active->fetchColumn()) respond(['error' => 'This account is not active.'], 403);
        $subject = $name === 'create_support_conversation' ? 'Live chat' : trim((string)($args['p_subject'] ?? ''));
        $message = $name === 'submit_support_ticket' ? trim((string)($args['p_body'] ?? '')) : '';
        if ($name === 'submit_support_ticket' && (strlen($subject) < 1 || strlen($subject) > 160 || strlen($message) < 1 || strlen($message) > 4000)) {
            throw new InvalidArgumentException('Subject or message is outside the allowed length.');
        }
        if ($name === 'create_support_conversation') {
            $existing = $pdo->prepare("SELECT id FROM support_conversations WHERE user_id = ? AND status = 'open' AND subject = 'Live chat' ORDER BY updated_at DESC LIMIT 1");
            $existing->execute([$userId]);
            $conversation = $existing->fetchColumn();
            if ($conversation) return $conversation;
        }
        $conversationId = uuid_v4();
        $pdo->beginTransaction();
        $pdo->prepare('INSERT INTO support_conversations (id, user_id, subject) VALUES (?, ?, ?)')->execute([$conversationId, $userId, $subject]);
        if ($name === 'submit_support_ticket') {
            $pdo->prepare('INSERT INTO support_messages (id, conversation_id, author_id, body) VALUES (?, ?, ?, ?)')
                ->execute([uuid_v4(), $conversationId, $userId, $message]);
        }
        $pdo->commit();
        return $conversationId;
    }

    if ($name === 'admin_start_support_conversation') {
        $admin = require_admin($pdo, $config);
        $targetId = (string)($args['p_user_id'] ?? '');
        $targetQuery = $pdo->prepare('SELECT user_id FROM profiles WHERE user_id = ?');
        $targetQuery->execute([$targetId]);
        if (!$targetQuery->fetch()) respond(['error' => 'User was not found.'], 404);
        $query = $pdo->prepare("SELECT id FROM support_conversations WHERE user_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1");
        $query->execute([$targetId]);
        $conversationId = $query->fetchColumn();
        $pdo->beginTransaction();
        if (!$conversationId) {
            $conversationId = uuid_v4();
            $pdo->prepare("INSERT INTO support_conversations (id, user_id, subject) VALUES (?, ?, 'Admin support')")
                ->execute([$conversationId, $targetId]);
        }
        $pdo->prepare('INSERT INTO admin_activity_log (id, actor_id, subject_user_id, action, details) VALUES (?, ?, ?, ?, ?)')
            ->execute([uuid_v4(), $admin['id'], $targetId, 'support_conversation_opened', json_encode(['conversation_id' => $conversationId], JSON_THROW_ON_ERROR)]);
        $pdo->commit();
        return $conversationId;
    }

    if ($name === 'send_support_message') {
        $conversationId = (string)($args['p_conversation_id'] ?? '');
        $message = trim((string)($args['p_body'] ?? ''));
        if (strlen($message) < 1 || strlen($message) > 4000) throw new InvalidArgumentException('Message must contain 1 to 4000 characters.');
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT user_id, status FROM support_conversations WHERE id = ? FOR UPDATE');
        $query->execute([$conversationId]);
        $conversation = $query->fetch();
        if (!$conversation || $conversation['status'] !== 'open') respond(['error' => 'Open conversation not found.'], 404);
        if (!$isAdmin && $conversation['user_id'] !== $userId) respond(['error' => 'Conversation access denied.'], 403);
        $messageId = uuid_v4();
        $pdo->prepare('INSERT INTO support_messages (id, conversation_id, author_id, body) VALUES (?, ?, ?, ?)')
            ->execute([$messageId, $conversationId, $userId, $message]);
        $pdo->prepare('UPDATE support_conversations SET updated_at = UTC_TIMESTAMP(3) WHERE id = ?')->execute([$conversationId]);
        $pdo->commit();
        return $messageId;
    }

    if ($name === 'admin_set_support_ticket_status') {
        require_admin($pdo, $config);
        $conversationId = (string)($args['p_conversation_id'] ?? '');
        $status = (string)($args['p_status'] ?? '');
        if (!in_array($status, ['open', 'closed'], true)) throw new InvalidArgumentException('Invalid ticket status.');
        $pdo->beginTransaction();
        $exists = $pdo->prepare('SELECT id FROM support_conversations WHERE id = ? FOR UPDATE');
        $exists->execute([$conversationId]);
        if (!$exists->fetch()) respond(['error' => 'Support ticket was not found.'], 404);
        $statement = $pdo->prepare('UPDATE support_conversations SET status = ?, updated_at = UTC_TIMESTAMP(3) WHERE id = ?');
        $statement->execute([$status, $conversationId]);
        $pdo->prepare('INSERT INTO admin_activity_log (id, actor_id, action, details) VALUES (?, ?, ?, ?)')
            ->execute([uuid_v4(), $userId, 'support_ticket_status_changed', json_encode(['conversation_id' => $conversationId, 'status' => $status], JSON_THROW_ON_ERROR)]);
        $pdo->commit();
        return null;
    }

    respond(['error' => 'This business operation has not been migrated yet: ' . $name], 501);
}
