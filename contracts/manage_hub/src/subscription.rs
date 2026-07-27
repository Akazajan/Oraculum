// Allow deprecated events API until migration to #[contractevent] macro
#![allow(deprecated)]

use soroban_sdk::{contracttype, symbol_short, Address, BytesN, Env, Map, String, Vec};

use crate::attendance_log::AttendanceLogModule;
use crate::errors::Error;
use crate::membership_token::DataKey as MembershipTokenDataKey;
use crate::types::{
    AttendanceAction, BillingCycle, CreatePromotionParams, CreateTierParams, MembershipStatus,
    PauseAction, PauseConfig, PauseHistoryEntry, PauseStats, Subscription, SubscriptionTier,
    TierAnalytics, TierChangeRequest, TierChangeStatus, TierChangeType, TierFeature, TierLevel,
    TierPromotion, UpdateTierParams, UserSubscriptionInfo,
};

#[contracttype]
pub enum SubscriptionDataKey {
    Subscription(String),
    UsdcContract,
    PauseConfig,
    // Tier storage keys
    Tier(String),
    TierList,
    TierPromotion(String),
    TierPromotionList,
    TierChangeRequest(String),
    UserTierChangeHistory(Address),
    TierAnalytics(String),
    UserSubscriptionByTier(Address, String),
}

pub struct SubscriptionContract;

impl SubscriptionContract {
    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&MembershipTokenDataKey::Admin)
            .ok_or(Error::AdminNotSet)?;

        if caller != &admin {
            return Err(Error::Unauthorized);
        }

        caller.require_auth();
        Ok(())
    }

    fn get_pause_config_or_default(env: &Env) -> PauseConfig {
        env.storage()
            .instance()
            .get(&SubscriptionDataKey::PauseConfig)
            .unwrap_or(PauseConfig {
                max_pause_duration: 2_592_000,
                max_pause_count: 3,
                min_active_time: 86_400,
            })
    }

    fn validate_pause_config(config: &PauseConfig) -> Result<(), Error> {
        if config.max_pause_duration == 0 {
            return Err(Error::InvalidPauseConfig);
        }
        if config.max_pause_count == 0 {
            return Err(Error::InvalidPauseConfig);
        }
        Ok(())
    }

    pub fn set_pause_config(env: Env, admin: Address, config: PauseConfig) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        Self::validate_pause_config(&config)?;
        env.storage()
            .instance()
            .set(&SubscriptionDataKey::PauseConfig, &config);
        Ok(())
    }

    pub fn get_pause_config(env: Env) -> PauseConfig {
        Self::get_pause_config_or_default(&env)
    }

    fn validate_payment(
        env: &Env,
        payment_token: &Address,
        amount: i128,
        _payer: &Address,
    ) -> Result<bool, Error> {
        // Check for non-negative amount
        if amount <= 0 {
            return Err(Error::InvalidPaymentAmount);
        }

        // Get USDC token contract address from storage
        let usdc_contract = Self::get_usdc_contract_address(env)?;

        // Validate that the payment token is USDC
        if payment_token != &usdc_contract {
            return Err(Error::InvalidPaymentToken);
        }

        // Note: Balance checking is omitted in this implementation.
        // In production, you would check the token balance using:
        // let token_client = token::Client::new(env, payment_token);
        // let balance = token_client.balance(payer);
        // if balance < amount { return Err(Error::InsufficientBalance); }

        Ok(true)
    }

    #[allow(deprecated)]
    /// Creates a subscription without tier (legacy support).
    /// For new subscriptions, prefer `create_subscription_with_tier`.
    pub fn create_subscription(
        env: Env,
        id: String,
        user: Address,
        payment_token: Address,
        amount: i128,
        duration: u64,
    ) -> Result<(), Error> {
        // Require user authentication
        user.require_auth();

        // Check if subscription already exists
        let key = SubscriptionDataKey::Subscription(id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::SubscriptionAlreadyExists);
        }

        // Validate payment first
        Self::validate_payment(&env, &payment_token, amount, &user)?;

        // Note: Token transfer is omitted in this implementation.
        // In production, you would transfer tokens using:
        // let token_client = token::Client::new(&env, &payment_token);
        // let contract_address = env.current_contract_address();
        // token_client.transfer(&user, &contract_address, &amount);

        // Create subscription record
        let current_time = env.ledger().timestamp();

        // Use checked addition to prevent overflow
        let expires_at = current_time
            .checked_add(duration)
            .ok_or(Error::TimestampOverflow)?;

        // Use empty tier_id for legacy subscriptions and default to Monthly billing
        let subscription = Subscription {
            id: id.clone(),
            user: user.clone(),
            payment_token: payment_token.clone(),
            amount,
            status: MembershipStatus::Active,
            created_at: current_time,
            expires_at,
            paused_at: None,
            last_resumed_at: current_time,
            pause_count: 0,
            total_paused_duration: 0,
            pause_history: Vec::new(&env),
            tier_id: String::from_str(&env, ""),
            billing_cycle: BillingCycle::Monthly,
        };

        // Store and extend TTL with same key
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        // Emit subscription created event
        env.events().publish(
            (symbol_short!("sub_creat"), id.clone(), user.clone()),
            (payment_token.clone(), amount, current_time, expires_at),
        );

        // Log attendance event for subscription creation
        Self::log_subscription_event(
            &env,
            &user,
            String::from_str(&env, "subscription_created"),
            &id,
            amount,
        )?;

        Ok(())
    }

    pub fn pause_subscription(env: Env, id: String, reason: Option<String>) -> Result<(), Error> {
        let key = SubscriptionDataKey::Subscription(id.clone());
        let subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        subscription.user.require_auth();
        let actor = subscription.user.clone();
        Self::pause_subscription_internal(env, id, subscription, actor, false, reason)
    }

    pub fn pause_subscription_admin(
        env: Env,
        id: String,
        admin: Address,
        reason: Option<String>,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let key = SubscriptionDataKey::Subscription(id.clone());
        let subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        Self::pause_subscription_internal(env, id, subscription, admin, true, reason)
    }

    #[allow(deprecated)]
    fn pause_subscription_internal(
        env: Env,
        id: String,
        mut subscription: Subscription,
        actor: Address,
        is_admin: bool,
        reason: Option<String>,
    ) -> Result<(), Error> {
        let current_time = env.ledger().timestamp();

        if subscription.status == MembershipStatus::Paused {
            return Err(Error::SubscriptionPaused);
        }
        if subscription.status == MembershipStatus::Invalid {
            return Err(Error::SubscriptionInvalid);
        }
        if subscription.status != MembershipStatus::Active {
            return Err(Error::SubscriptionNotActive);
        }
        if current_time >= subscription.expires_at {
            return Err(Error::SubscriptionNotActive);
        }

        let config = Self::get_pause_config_or_default(&env);
        if !is_admin {
            if subscription.pause_count >= config.max_pause_count {
                return Err(Error::PauseCountExceeded);
            }

            let since_last_resume = current_time.saturating_sub(subscription.last_resumed_at);
            if since_last_resume < config.min_active_time {
                return Err(Error::PauseTooEarly);
            }
        }

        subscription.status = MembershipStatus::Paused;
        subscription.paused_at = Some(current_time);
        subscription.pause_count = subscription.pause_count.saturating_add(1);

        let entry = PauseHistoryEntry {
            action: PauseAction::Pause,
            timestamp: current_time,
            actor: actor.clone(),
            is_admin,
            reason: reason.clone(),
            paused_duration: None,
            applied_extension: None,
        };
        subscription.pause_history.push_back(entry.clone());

        let key = SubscriptionDataKey::Subscription(id.clone());
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        env.events().publish(
            (
                symbol_short!("subscr"),
                id.clone(),
                subscription.user.clone(),
            ),
            entry,
        );

        Self::log_subscription_event(
            &env,
            &subscription.user,
            String::from_str(&env, "subscription_paused"),
            &id,
            subscription.amount,
        )?;

        Ok(())
    }

    pub fn resume_subscription(env: Env, id: String) -> Result<(), Error> {
        let key = SubscriptionDataKey::Subscription(id.clone());
        let subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        subscription.user.require_auth();
        let actor = subscription.user.clone();
        Self::resume_subscription_internal(env, id, subscription, actor, false)
    }

    pub fn resume_subscription_admin(env: Env, id: String, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let key = SubscriptionDataKey::Subscription(id.clone());
        let subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        Self::resume_subscription_internal(env, id, subscription, admin, true)
    }

    #[allow(deprecated)]
    fn resume_subscription_internal(
        env: Env,
        id: String,
        mut subscription: Subscription,
        actor: Address,
        is_admin: bool,
    ) -> Result<(), Error> {
        if subscription.status == MembershipStatus::Invalid {
            return Err(Error::SubscriptionInvalid);
        }
        if subscription.status != MembershipStatus::Paused {
            return Err(Error::SubscriptionNotPaused);
        }

        let paused_at = subscription.paused_at.ok_or(Error::SubscriptionNotPaused)?;
        let current_time = env.ledger().timestamp();
        let paused_duration = current_time
            .checked_sub(paused_at)
            .ok_or(Error::TimestampOverflow)?;

        let config = Self::get_pause_config_or_default(&env);
        let applied_extension = if is_admin {
            paused_duration
        } else if paused_duration > config.max_pause_duration {
            config.max_pause_duration
        } else {
            paused_duration
        };

        subscription.expires_at = subscription
            .expires_at
            .checked_add(applied_extension)
            .ok_or(Error::TimestampOverflow)?;
        subscription.status = MembershipStatus::Active;
        subscription.paused_at = None;
        subscription.last_resumed_at = current_time;
        subscription.total_paused_duration = subscription
            .total_paused_duration
            .checked_add(paused_duration)
            .ok_or(Error::TimestampOverflow)?;

        let entry = PauseHistoryEntry {
            action: PauseAction::Resume,
            timestamp: current_time,
            actor: actor.clone(),
            is_admin,
            reason: None,
            paused_duration: Some(paused_duration),
            applied_extension: Some(applied_extension),
        };
        subscription.pause_history.push_back(entry.clone());

        let key = SubscriptionDataKey::Subscription(id.clone());
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        env.events().publish(
            (
                symbol_short!("subscr"),
                id.clone(),
                subscription.user.clone(),
            ),
            entry,
        );

        Self::log_subscription_event(
            &env,
            &subscription.user,
            String::from_str(&env, "subscription_resumed"),
            &id,
            subscription.amount,
        )?;

        Ok(())
    }

    pub fn get_pause_history(env: Env, id: String) -> Result<Vec<PauseHistoryEntry>, Error> {
        let subscription = Self::get_subscription(env, id)?;
        Ok(subscription.pause_history)
    }

    pub fn get_pause_stats(env: Env, id: String) -> Result<PauseStats, Error> {
        let subscription = Self::get_subscription(env, id)?;
        Ok(PauseStats {
            pause_count: subscription.pause_count,
            total_paused_duration: subscription.total_paused_duration,
            is_paused: subscription.status == MembershipStatus::Paused,
            paused_at: subscription.paused_at,
            tier_id: subscription.tier_id,
            billing_cycle: subscription.billing_cycle,
        })
    }

    pub fn get_subscription(env: Env, id: String) -> Result<Subscription, Error> {
        env.storage()
            .persistent()
            .get(&SubscriptionDataKey::Subscription(id))
            .ok_or(Error::SubscriptionNotFound)
    }

    #[allow(deprecated)]
    pub fn set_usdc_contract(env: Env, admin: Address, usdc_address: Address) -> Result<(), Error> {
        admin.require_auth();

        // Check if admin is authorized (you might want to implement admin checking logic)
        // For now, we'll store the USDC contract address
        env.storage()
            .instance()
            .set(&SubscriptionDataKey::UsdcContract, &usdc_address);

        // Emit USDC contract set event
        env.events().publish(
            (symbol_short!("usdc_set"), usdc_address.clone()),
            (admin.clone(), env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn get_usdc_contract_address(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&SubscriptionDataKey::UsdcContract)
            .ok_or(Error::UsdcContractNotSet)
    }

    #[allow(deprecated)]
    pub fn revoke_subscription(env: Env, id: String, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let key = SubscriptionDataKey::Subscription(id.clone());
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        let old_status = subscription.status.clone();
        if old_status == MembershipStatus::Revoked {
            return Err(Error::SubscriptionAlreadyRevoked);
        }

        subscription.status = MembershipStatus::Revoked;
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        env.events().publish(
            (
                symbol_short!("sub_revok"),
                id.clone(),
                subscription.user.clone(),
            ),
            (
                env.ledger().timestamp(),
                old_status,
                MembershipStatus::Revoked,
            ),
        );

        Self::log_subscription_event(
            &env,
            &subscription.user,
            String::from_str(&env, "subscription_revoked"),
            &id,
            subscription.amount,
        )?;

        Ok(())
    }

    #[allow(deprecated)]
    pub fn invalidate_subscription(env: Env, id: String, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let key = SubscriptionDataKey::Subscription(id.clone());
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        let old_status = subscription.status.clone();
        if old_status == MembershipStatus::Invalid {
            return Err(Error::SubscriptionInvalid);
        }

        subscription.status = MembershipStatus::Invalid;
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        env.events().publish(
            (
                symbol_short!("sub_inval"),
                id.clone(),
                subscription.user.clone(),
            ),
            (
                env.ledger().timestamp(),
                old_status,
                MembershipStatus::Invalid,
            ),
        );

        Self::log_subscription_event(
            &env,
            &subscription.user,
            String::from_str(&env, "subscription_invalidated"),
            &id,
            subscription.amount,
        )?;

        Ok(())
    }

    #[allow(deprecated)]
    pub fn cancel_subscription(env: Env, id: String) -> Result<(), Error> {
        let key = SubscriptionDataKey::Subscription(id.clone());
        let mut subscription: Subscription = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::SubscriptionNotFound)?;

        // Require authorization from the subscription owner
        subscription.user.require_auth();

        // Capture old status for event emission
        let old_status = subscription.status.clone();

        // Update status to inactive
        subscription.status = MembershipStatus::Inactive;
        subscription.paused_at = None;
        env.storage().persistent().set(&key, &subscription);

        // Emit subscription cancelled event
        env.events().publish(
            (
                symbol_short!("sub_cancl"),
                id.clone(),
                subscription.user.clone(),
            ),
            (
                env.ledger().timestamp(),
                old_status,
                MembershipStatus::Inactive,
            ),
        );

        Ok(())
    }

    #[allow(deprecated)]
    /// Renews a subscription for additional duration.
    pub fn renew_subscription(
        env: Env,
        id: String,
        payment_token: Address,
        amount: i128,
        duration: u64,
    ) -> Result<(), Error> {
        // Get existing subscription
        let key = SubscriptionDataKey::Subscription(id.clone());
        let mut subscription = Self::get_subscription(env.clone(), id.clone())?;

        // Capture old expiry for event emission
        let old_expiry = subscription.expires_at;

        // Require authorization from subscription owner
        subscription.user.require_auth();

        if subscription.status == MembershipStatus::Paused {
            return Err(Error::SubscriptionPaused);
        }

        if subscription.status == MembershipStatus::Revoked {
            return Err(Error::SubscriptionAlreadyRevoked);
        }

        if subscription.status == MembershipStatus::Invalid {
            return Err(Error::SubscriptionInvalid);
        }

        // Validate payment
        Self::validate_payment(&env, &payment_token, amount, &subscription.user)?;

        // Note: Token transfer is omitted in this implementation.
        // In production, you would transfer tokens using:
        // let token_client = token::Client::new(&env, &payment_token);
        // let contract_address = env.current_contract_address();
        // token_client.transfer(&subscription.user, &contract_address, &amount);

        // Update subscription details - extend from current expiry date or current time, whichever is later
        let current_time = env.ledger().timestamp();
        let renewal_base = if subscription.expires_at > current_time {
            subscription.expires_at
        } else {
            current_time
        };

        subscription.expires_at = renewal_base
            .checked_add(duration)
            .ok_or(Error::TimestampOverflow)?;
        subscription.status = MembershipStatus::Active;
        subscription.amount = amount;

        // Store updated subscription and extend TTL
        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        // Update tier analytics if subscription has a tier
        if !subscription.tier_id.is_empty() {
            let _ = Self::update_tier_analytics_on_subscribe(&env, &subscription.tier_id, amount);
        }

        // Emit subscription renewed event
        env.events().publish(
            (
                symbol_short!("sub_renew"),
                id.clone(),
                subscription.user.clone(),
            ),
            (
                payment_token.clone(),
                amount,
                old_expiry,
                subscription.expires_at,
            ),
        );

        // Log attendance event for subscription renewal
        Self::log_subscription_event(
            &env,
            &subscription.user,
            String::from_str(&env, "subscription_renewed"),
            &id,
            amount,
        )?;

        Ok(())
    }

    /// Helper function to log subscription events to attendance log
    fn log_subscription_event(
        env: &Env,
        user: &Address,
        action: String,
        subscription_id: &String,
        _amount: i128,
    ) -> Result<(), Error> {
        // Generate event_id from subscription_id
        let event_id = Self::generate_event_id(env, subscription_id);

        // Create event details map
        let mut details: Map<String, String> = Map::new(env);
        details.set(String::from_str(env, "action"), action.clone());
        details.set(
            String::from_str(env, "subscription_id"),
            subscription_id.clone(),
        );

        // Store amount as string - use simple string representation
        // For production, consider using a proper number to string conversion library
        details.set(
            String::from_str(env, "amount"),
            String::from_str(env, "amount_logged"),
        );

        // Store timestamp marker
        details.set(
            String::from_str(env, "timestamp"),
            String::from_str(env, "event_time"),
        );

        // Determine the attendance action based on the event type
        let attendance_action = if action == String::from_str(env, "subscription_created") {
            AttendanceAction::ClockIn
        } else {
            AttendanceAction::ClockOut
        };

        // Call AttendanceLogModule to log the attendance (internal version without auth)
        AttendanceLogModule::log_attendance_internal(
            env.clone(),
            event_id,
            user.clone(),
            attendance_action,
            details,
        )
        .map_err(|_| Error::AttendanceLogFailed)?;

        Ok(())
    }

    /// Generate a deterministic event_id from subscription_id
    fn generate_event_id(env: &Env, subscription_id: &String) -> BytesN<32> {
        // Use a simple hashing mechanism for event_id generation
        env.crypto().sha256(&subscription_id.to_bytes())
    }

    // ============================================================================
    // Tier Management Functions
    // ============================================================================

    #[allow(deprecated)]
    pub fn create_tier(env: Env, admin: Address, params: CreateTierParams) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let tier_key = SubscriptionDataKey::Tier(params.id.clone());
        if env.storage().persistent().has(&tier_key) {
            return Err(Error::TierAlreadyExists);
        }

        if params.price < 0 || params.annual_price < 0 {
            return Err(Error::InvalidTierPrice);
        }

        let current_time = env.ledger().timestamp();
        let tier = SubscriptionTier {
            id: params.id.clone(),
            name: params.name,
            level: params.level,
            price: params.price,
            annual_price: params.annual_price,
            features: params.features,
            max_users: params.max_users,
            max_storage: params.max_storage,
            is_active: params.is_active,
            created_at: current_time,
            updated_at: current_time,
        };

        env.storage().persistent().set(&tier_key, &tier);
        env.storage().persistent().extend_ttl(&tier_key, 100, 1000);

        // Add tier to the list of all tiers
        let mut tier_list = Self::get_all_tiers_list(&env);
        tier_list.push_back(tier.id.clone());
        env.storage()
            .instance()
            .set(&SubscriptionDataKey::TierList, &tier_list);

        // Initialize tier analytics
        let analytics = TierAnalytics {
            tier_id: tier.id.clone(),
            total_subscriptions: 0,
            total_revenue: 0,
            active_subscriptions: 0,
            churn_rate: 0, // Placeholder
        };
        env.storage().persistent().set(
            &SubscriptionDataKey::TierAnalytics(tier.id.clone()),
            &analytics,
        );

        env.events().publish(
            (symbol_short!("tier_cr"), tier.id.clone()),
            (tier.clone(), admin.clone()),
        );

        Ok(())
    }

    pub fn get_tier(env: Env, id: String) -> Result<SubscriptionTier, Error> {
        env.storage()
            .persistent()
            .get(&SubscriptionDataKey::Tier(id))
            .ok_or(Error::TierNotFound)
    }

    pub fn get_all_tiers(env: Env) -> Result<Vec<SubscriptionTier>, Error> {
        let tier_list = Self::get_all_tiers_list(&env);
        let mut tiers = Vec::new(&env);
        for tier_id in tier_list.iter() {
            if let Ok(tier) = Self::get_tier(env.clone(), tier_id) {
                tiers.push_back(tier);
            }
        }
        Ok(tiers)
    }

    fn get_all_tiers_list(env: &Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&SubscriptionDataKey::TierList)
            .unwrap_or_else(|| Vec::new(env))
    }

    #[allow(deprecated)]
    pub fn update_tier(env: Env, admin: Address, params: UpdateTierParams) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let tier_key = SubscriptionDataKey::Tier(params.id.clone());
        let mut tier = Self::get_tier(env.clone(), params.id.clone())?;

        if let Some(name) = params.name {
            tier.name = name;
        }
        if let Some(level) = params.level {
            tier.level = level;
        }
        if let Some(price) = params.price {
            if price < 0 {
                return Err(Error::InvalidTierPrice);
            }
            tier.price = price;
        }
        if let Some(annual_price) = params.annual_price {
            if annual_price < 0 {
                return Err(Error::InvalidTierPrice);
            }
            tier.annual_price = annual_price;
        }
        if let Some(features) = params.features {
            tier.features = features;
        }
        if let Some(max_users) = params.max_users {
            tier.max_users = max_users;
        }
        if let Some(max_storage) = params.max_storage {
            tier.max_storage = max_storage;
        }
        if let Some(is_active) = params.is_active {
            tier.is_active = is_active;
        }

        tier.updated_at = env.ledger().timestamp();

        env.storage().persistent().set(&tier_key, &tier);
        env.storage().persistent().extend_ttl(&tier_key, 100, 1000);

        env.events().publish(
            (symbol_short!("tier_upd"), tier.id.clone()),
            (tier.clone(), admin.clone()),
        );

        Ok(())
    }

    // ============================================================================
    // Tier Subscription Functions
    // ============================================================================

    #[allow(deprecated)]
    pub fn create_subscription_with_tier(
        env: Env,
        user: Address,
        tier_id: String,
        billing_cycle: BillingCycle,
        promo_code: Option<String>,
    ) -> Result<(), Error> {
        user.require_auth();

        let tier = Self::get_tier(env.clone(), tier_id.clone())?;
        if !tier.is_active {
            return Err(Error::TierNotActive);
        }

        let (amount, duration) =
            Self::calculate_price_and_duration(&env, &tier, &billing_cycle, promo_code)?;

        // Use a composite ID for the subscription to ensure uniqueness per user-tier
        let subscription_id = Self::generate_subscription_id(&env, &user, &tier_id);

        let key = SubscriptionDataKey::Subscription(subscription_id.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::SubscriptionAlreadyExists);
        }

        let usdc_contract = Self::get_usdc_contract_address(&env)?;
        Self::validate_payment(&env, &usdc_contract, amount, &user)?;

        // Note: Token transfer is omitted in this implementation.
        // In production, you would transfer tokens using:
        // let token_client = token::Client::new(&env, &usdc_contract);
        // let contract_address = env.current_contract_address();
        // token_client.transfer(&user, &contract_address, &amount);

        let current_time = env.ledger().timestamp();
        let expires_at = current_time
            .checked_add(duration)
            .ok_or(Error::TimestampOverflow)?;

        let subscription = Subscription {
            id: subscription_id.clone(),
            user: user.clone(),
            payment_token: usdc_contract.clone(),
            amount,
            status: MembershipStatus::Active,
            created_at: current_time,
            expires_at,
            paused_at: None,
            last_resumed_at: current_time,
            pause_count: 0,
            total_paused_duration: 0,
            pause_history: Vec::new(&env),
            tier_id: tier_id.clone(),
            billing_cycle: billing_cycle.clone(),
        };

        env.storage().persistent().set(&key, &subscription);
        env.storage().persistent().extend_ttl(&key, 100, 1000);

        // Store user-tier mapping
        let user_tier_key =
            SubscriptionDataKey::UserSubscriptionByTier(user.clone(), tier_id.clone());
        env.storage()
            .persistent()
            .set(&user_tier_key, &subscription.id);
        env.storage()
            .persistent()
            .extend_ttl(&user_tier_key, 100, 1000);

        // Update tier analytics
        Self::update_tier_analytics_on_subscribe(&env, &tier_id, amount)?;

        env.events().publish(
            (symbol_short!("sub_tier"), subscription_id.clone()),
            (user.clone(), tier_id.clone(), billing_cycle, amount),
        );

        Self::log_subscription_event(
            &env,
            &user,
            String::from_str(&env, "subscription_tier_created"),
            &subscription_id,
            amount,
        )?;

        Ok(())
    }

    fn generate_subscription_id(env: &Env, user: &Address, tier_id: &String) -> String {
        // Simple string concatenation for ID generation.
        // In a real-world scenario, you might use a more robust method.
        let mut id_parts = String::from_str(env, "sub_");
        id_parts.append(&user.to_string());
        id_parts.append(&String::from_str(env, "_"));
        id_parts.append(tier_id);
        id_parts
    }

    fn calculate_price_and_duration(
        env: &Env,
        tier: &SubscriptionTier,
        billing_cycle: &BillingCycle,
        promo_code: Option<String>,
    ) -> Result<(i128, u64), Error> {
        let (base_price, duration) = match billing_cycle {
            BillingCycle::Monthly => (tier.price, 2_592_000), // 30 days
            BillingCycle::Annually => (tier.annual_price, 31_536_000), // 365 days
        };

        if let Some(code) = promo_code {
            if !code.is_empty() {
                let promotion = Self::get_promotion_by_code(env, code)?;
                if promotion.tier_id != tier.id {
                    return Err(Error::PromoCodeInvalid);
                }
                return Self::apply_promotion(env, promotion, base_price, duration);
            }
        }

        Ok((base_price, duration))
    }

    // ============================================================================
    // Tier Promotion Functions
    // ============================================================================

    #[allow(deprecated)]
    pub fn create_promotion(
        env: Env,
        admin: Address,
        params: CreatePromotionParams,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        // Validate that the tier exists
        let _ = Self::get_tier(env.clone(), params.tier_id.clone())?;

        let promo_key = SubscriptionDataKey::TierPromotion(params.promo_code.clone());
        if env.storage().persistent().has(&promo_key) {
            return Err(Error::PromotionAlreadyExists);
        }

        if params.discount_percent > 100 {
            return Err(Error::InvalidDiscountPercent);
        }
        if params.start_date >= params.end_date {
            return Err(Error::InvalidPromoDateRange);
        }

        let promotion = TierPromotion {
            tier_id: params.tier_id,
            discount_percent: params.discount_percent,
            promo_price: params.promo_price,
            start_date: params.start_date,
            end_date: params.end_date,
            promo_code: params.promo_code.clone(),
            max_redemptions: params.max_redemptions,
            current_redemptions: 0,
        };

        env.storage().persistent().set(&promo_key, &promotion);
        env.storage().persistent().extend_ttl(&promo_key, 100, 1000);

        // Add to promotion list
        let mut promo_list = Self::get_all_promotions_list(&env);
        promo_list.push_back(promotion.promo_code.clone());
        env.storage()
            .instance()
            .set(&SubscriptionDataKey::TierPromotionList, &promo_list);

        env.events().publish(
            (symbol_short!("promo_cr"), promotion.promo_code.clone()),
            (promotion.clone(), admin.clone()),
        );

        Ok(())
    }

    pub fn get_promotion_by_code(env: &Env, promo_code: String) -> Result<TierPromotion, Error> {
        let promo_key = SubscriptionDataKey::TierPromotion(promo_code);
        env.storage()
            .persistent()
            .get(&promo_key)
            .ok_or(Error::PromotionNotFound)
    }

    fn get_all_promotions_list(env: &Env) -> Vec<String> {
        env.storage()
            .instance()
            .get(&SubscriptionDataKey::TierPromotionList)
            .unwrap_or_else(|| Vec::new(env))
    }

    fn apply_promotion(
        env: &Env,
        mut promotion: TierPromotion,
        base_price: i128,
        duration: u64,
    ) -> Result<(i128, u64), Error> {
        let current_time = env.ledger().timestamp();
        if current_time < promotion.start_date || current_time > promotion.end_date {
            return Err(Error::PromoCodeExpired);
        }
        if promotion.max_redemptions > 0
            && promotion.current_redemptions >= promotion.max_redemptions
        {
            return Err(Error::PromoCodeMaxRedemptions);
        }

        promotion.current_redemptions += 1;
        let promo_key = SubscriptionDataKey::TierPromotion(promotion.promo_code.clone());
        env.storage().persistent().set(&promo_key, &promotion);

        if promotion.promo_price > 0 {
            return Ok((promotion.promo_price, duration));
        }

        let discount = (base_price * i128::from(promotion.discount_percent)) / 100;
        Ok((base_price - discount, duration))
    }

    // ============================================================================
    // Tier Change (Upgrade/Downgrade) Functions
    // ============================================================================

    #[allow(deprecated)]
    pub fn request_tier_change(
        env: Env,
        user: Address,
        from_tier_id: String,
        to_tier_id: String,
    ) -> Result<TierChangeRequest, Error> {
        user.require_auth();

        let from_tier = Self::get_tier(env.clone(), from_tier_id.clone())?;
        let to_tier = Self::get_tier(env.clone(), to_tier_id.clone())?;

        let subscription_id = Self::generate_subscription_id(&env, &user, &from_tier_id);
        let subscription = Self::get_subscription(env.clone(), subscription_id)?;

        let (change_type, prorated_amount) =
            Self::calculate_proration(&env, &subscription, &from_tier, &to_tier)?;

        let current_time = env.ledger().timestamp();
        let request = TierChangeRequest {
            user: user.clone(),
            from_tier: from_tier_id.clone(),
            to_tier: to_tier_id.clone(),
            change_type,
            prorated_amount,
            effective_date: current_time, // Immediate for simplicity
            status: TierChangeStatus::Pending,
            created_at: current_time,
        };

        // Store the request
        let request_id = Self::generate_tier_change_request_id(&env, &user, &to_tier_id);
        let request_key = SubscriptionDataKey::TierChangeRequest(request_id.clone());
        env.storage().persistent().set(&request_key, &request);
        env.storage().persistent().extend_ttl(&request_key, 100, 1000);

        // Add to user's history
        let mut history = Self::get_user_tier_change_history(&env, &user);
        history.push_back(request_id.clone());
        env.storage().persistent().set(
            &SubscriptionDataKey::UserTierChangeHistory(user.clone()),
            &history,
        );

        env.events().publish(
            (symbol_short!("tier_chg"), request_id),
            (user, from_tier_id, to_tier_id),
        );

        Ok(request)
    }

    fn generate_tier_change_request_id(
        env: &Env,
        user: &Address,
        to_tier_id: &String,
    ) -> String {
        let mut id_parts = String::from_str(env, "tcr_");
        id_parts.append(&user.to_string());
        id_parts.append(&String::from_str(env, "_"));
        id_parts.append(to_tier_id);
        id_parts.append(&String::from_str(
            env,
            &env.ledger().timestamp().to_string(),
        ));
        id_parts
    }

    fn get_user_tier_change_history(env: &Env, user: &Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&SubscriptionDataKey::UserTierChangeHistory(user.clone()))
            .unwrap_or_else(|| Vec::new(env))
    }

    fn calculate_proration(
        env: &Env,
        subscription: &Subscription,
        from_tier: &SubscriptionTier,
        to_tier: &SubscriptionTier,
    ) -> Result<(TierChangeType, i128), Error> {
        let remaining_time = subscription
            .expires_at
            .saturating_sub(env.ledger().timestamp());
        let total_time = match subscription.billing_cycle {
            BillingCycle::Monthly => 2_592_000,
            BillingCycle::Annually => 31_536_000,
        };

        let from_price = match subscription.billing_cycle {
            BillingCycle::Monthly => from_tier.price,
            BillingCycle::Annually => from_tier.annual_price,
        };
        let to_price = match subscription.billing_cycle {
            BillingCycle::Monthly => to_tier.price,
            BillingCycle::Annually => to_tier.annual_price,
        };

        let remaining_value = (from_price * i128::from(remaining_time)) / i128::from(total_time);
        let new_cost = (to_price * i128::from(remaining_time)) / i128::from(total_time);

        let prorated_amount = new_cost - remaining_value;

        let change_type = if to_price > from_price {
            TierChangeType::Upgrade
        } else if to_price < from_price {
            TierChangeType::Downgrade
        } else {
            TierChangeType::Lateral
        };

        Ok((change_type, prorated_amount))
    }

    #[allow(deprecated)]
    pub fn approve_tier_change(
        env: Env,
        admin: Address,
        request_id: String,
    ) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;

        let request_key = SubscriptionDataKey::TierChangeRequest(request_id.clone());
        let mut request: TierChangeRequest = env
            .storage()
            .persistent()
            .get(&request_key)
            .ok_or(Error::TierChangeNotFound)?;

        if request.status != TierChangeStatus::Pending {
            return Err(Error::TierChangeAlreadyProcessed);
        }

        // For upgrades, process payment for prorated amount
        if request.change_type == TierChangeType::Upgrade && request.prorated_amount > 0 {
            let usdc_contract = Self::get_usdc_contract_address(&env)?;
            Self::validate_payment(&env, &usdc_contract, request.prorated_amount, &request.user)?;
            // Note: Token transfer is omitted in this implementation.
        }

        request.status = TierChangeStatus::Approved;
        env.storage().persistent().set(&request_key, &request);

        // Apply the change immediately
        Self::apply_tier_change(&env, &request)?;

        Ok(())
    }

    fn apply_tier_change(env: &Env, request: &TierChangeRequest) -> Result<(), Error> {
        let from_subscription_id =
            Self::generate_subscription_id(env, &request.user, &request.from_tier);
        let mut subscription = Self::get_subscription(env.clone(), from_subscription_id.clone())?;

        // Cancel old subscription
        subscription.status = MembershipStatus::Inactive;
        let old_key = SubscriptionDataKey::Subscription(from_subscription_id);
        env.storage().persistent().set(&old_key, &subscription);

        // Create new subscription record for the new tier
        let to_subscription_id =
            Self::generate_subscription_id(env, &request.user, &request.to_tier);
        let new_key = SubscriptionDataKey::Subscription(to_subscription_id.clone());

        let new_subscription = Subscription {
            id: to_subscription_id.clone(),
            tier_id: request.to_tier.clone(),
            ..subscription
        };

        env.storage().persistent().set(&new_key, &new_subscription);
        env.storage().persistent().extend_ttl(&new_key, 100, 1000);

        // Update user-tier mapping
        let user_tier_key =
            SubscriptionDataKey::UserSubscriptionByTier(request.user.clone(), request.to_tier.clone());
        env.storage()
            .persistent()
            .set(&user_tier_key, &to_subscription_id);
        env.storage()
            .persistent()
            .extend_ttl(&user_tier_key, 100, 1000);

        // Update analytics
        Self::update_tier_analytics_on_change(env, &request.from_tier, &request.to_tier)?;

        Ok(())
    }

    // ============================================================================
    // Analytics Functions
    // ============================================================================

    fn update_tier_analytics_on_subscribe(
        env: &Env,
        tier_id: &String,
        amount: i128,
    ) -> Result<(), Error> {
        let key = SubscriptionDataKey::TierAnalytics(tier_id.clone());
        let mut analytics: TierAnalytics = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::TierNotFound)?; // Should not happen if tier exists

        analytics.total_subscriptions += 1;
        analytics.active_subscriptions += 1;
        analytics.total_revenue += amount;

        env.storage().persistent().set(&key, &analytics);
        Ok(())
    }

    fn update_tier_analytics_on_change(
        env: &Env,
        from_tier_id: &String,
        to_tier_id: &String,
    ) -> Result<(), Error> {
        // Decrement from_tier active count
        let from_key = SubscriptionDataKey::TierAnalytics(from_tier_id.clone());
        let mut from_analytics: TierAnalytics = env.storage().persistent().get(&from_key).unwrap();
        from_analytics.active_subscriptions -= 1;
        env.storage().persistent().set(&from_key, &from_analytics);

        // Increment to_tier active count
        let to_key = SubscriptionDataKey::TierAnalytics(to_tier_id.clone());
        let mut to_analytics: TierAnalytics = env.storage().persistent().get(&to_key).unwrap();
        to_analytics.active_subscriptions += 1;
        env.storage().persistent().set(&to_key, &to_analytics);

        Ok(())
    }

    pub fn get_tier_analytics(env: Env, tier_id: String) -> Result<TierAnalytics, Error> {
        env.storage()
            .persistent()
            .get(&SubscriptionDataKey::TierAnalytics(tier_id))
            .ok_or(Error::TierNotFound)
    }

    // ============================================================================
    // User-facing Subscription Info
    // ============================================================================

    pub fn get_user_subscription_info(
        env: Env,
        user: Address,
        tier_id: String,
    ) -> Result<UserSubscriptionInfo, Error> {
        let sub_id_key = SubscriptionDataKey::UserSubscriptionByTier(user, tier_id);
        let subscription_id: String = env
            .storage()
            .persistent()
            .get(&sub_id_key)
            .ok_or(Error::SubscriptionNotFound)?;

        let subscription = Self::get_subscription(env, subscription_id)?;

        Ok(UserSubscriptionInfo {
            id: subscription.id,
            status: subscription.status,
            expires_at: subscription.expires_at,
            tier_id: subscription.tier_id,
            billing_cycle: subscription.billing_cycle,
        })
    }
}