SET @referral_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'referrals'
    AND index_name = 'referrals_referrer_created'
);

SET @referral_index_sql = IF(
  @referral_index_exists = 0,
  'ALTER TABLE referrals ADD INDEX referrals_referrer_created (referrer_id, created_at)',
  'SELECT ''Index referrals_referrer_created already exists'''
);

PREPARE referral_index_statement FROM @referral_index_sql;
EXECUTE referral_index_statement;
DEALLOCATE PREPARE referral_index_statement;
