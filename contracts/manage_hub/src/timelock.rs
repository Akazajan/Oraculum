//! Timelock support for governance and config updates.
//!
//! Provides a [`TimeLockManager`] that queues proposed actions, enforces a
//! configurable delay, and only allows execution once the delay has elapsed.
//! An optional admin-configured expiry window closes the execution window so
//! that stale operations cannot be executed indefinitely after the delay.

use crate::errors::Error;
use soroban_sdk::{contracterror, contracttype, Address, Env, String, Vec};

/// Maximum number of pending timelock entries stored at once.
const MAX_PENDING: u32 = 100;

/// Action type classification for timelocked operations.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ActionType {
    SetAdmin,
    SetUsdcContract,
    SetPauseConfig,
    UpgradeContract,
    ConfigUpdate(String),
}

/// A single queued timelock entry.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct TimeLockEntry {
    /// Unique action identifier
    pub action_id: u64,
    /// The action to be executed
    pub action_type: ActionType,
    /// Who proposed the action
    pub proposed_by: Address,
    /// Timestamp when the action was queued
    pub queued_at: u64,
    /// Earliest timestamp at which the action can be executed
    pub execute_after: u64,
    /// Whether the action has been executed
    pub executed: bool,
    /// Whether the action has been cancelled
    pub cancelled: bool,
}

/// Persistent storage key for the timelock module.
#[contracttype]
pub enum TimeLockDataKey {
    /// Global counter for unique action IDs
    ActionCounter,
    /// Individual entry by action_id
    Entry(u64),
    /// List of all pending (uncancelled, unexecuted) action IDs
    PendingList,
    /// The configured delay duration in seconds
    DelayDuration,
    /// The configured execution expiry window in seconds.
    ///
    /// Zero means "no expiry": a queued action remains executable
    /// indefinitely once its delay has elapsed.
    ExpiryWindow,
    /// Per-entry execution deadline (ledger timestamp), derived from the
    /// [`ExpiryWindow`](TimeLockDataKey::ExpiryWindow) at queue time.
    ///
    /// Keyed by `action_id`. Absent for entries queued with no expiry.
    Expiry(u64),
}

/// Errors specific to the timelock module.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TimeLockError {
    DelayNotElapsed = 100,
    AlreadyExecuted = 101,
    AlreadyCancelled = 102,
    NotFound = 103,
    Unauthorized = 104,
    PendingLimitReached = 105,
    InvalidDelay = 106,
    /// The queued action's execution window has closed.
    OperationExpired = 107,
}

impl From<TimeLockError> for Error {
    fn from(_: TimeLockError) -> Self {
        Error::Unauthorized
    }
}

pub struct TimeLockManager;

impl TimeLockManager {
    /// Set the timelock delay duration (in seconds). Admin only.
    pub fn set_delay(env: &Env, admin: &Address, delay_seconds: u64) -> Result<(), TimeLockError> {
        admin.require_auth();

        if delay_seconds == 0 {
            return Err(TimeLockError::InvalidDelay);
        }

        env.storage()
            .instance()
            .set(&TimeLockDataKey::DelayDuration, &delay_seconds);

        Ok(())
    }

    /// Get the configured delay duration (defaults to 0 if not set).
    pub fn get_delay(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&TimeLockDataKey::DelayDuration)
            .unwrap_or(0)
    }

    /// Set the execution expiry window (in seconds). Admin only.
    ///
    /// A queued action may only be executed within this window after its
    /// delay has elapsed; once the window closes the action expires and can
    /// no longer be executed. Zero disables the expiry behaviour entirely.
    pub fn set_expiry_window(
        env: &Env,
        admin: &Address,
        window_seconds: u64,
    ) -> Result<(), TimeLockError> {
        admin.require_auth();

        env.storage()
            .instance()
            .set(&TimeLockDataKey::ExpiryWindow, &window_seconds);

        Ok(())
    }

    /// Get the configured execution expiry window (defaults to 0 if not set).
    pub fn get_expiry_window(env: &Env) -> u64 {
        env.storage()
            .instance()
            .get(&TimeLockDataKey::ExpiryWindow)
            .unwrap_or(0)
    }

    /// Queue a new action for timelock execution.
    ///
    /// Returns the assigned action ID.
    pub fn queue_action(
        env: &Env,
        proposed_by: &Address,
        action_type: ActionType,
    ) -> Result<u64, TimeLockError> {
        proposed_by.require_auth();

        let delay = Self::get_delay(env);
        let now = env.ledger().timestamp();
        let execute_after = now.checked_add(delay).ok_or(TimeLockError::InvalidDelay)?;

        // Increment action counter
        let counter: u64 = env
            .storage()
            .instance()
            .get(&TimeLockDataKey::ActionCounter)
            .unwrap_or(0);
        let action_id = counter.checked_add(1).ok_or(TimeLockError::InvalidDelay)?;
        env.storage()
            .instance()
            .set(&TimeLockDataKey::ActionCounter, &action_id);

        let entry = TimeLockEntry {
            action_id,
            action_type,
            proposed_by: proposed_by.clone(),
            queued_at: now,
            execute_after,
            executed: false,
            cancelled: false,
        };

        env.storage()
            .persistent()
            .set(&TimeLockDataKey::Entry(action_id), &entry);

        // Persist the expiry deadline when an execution window is configured so
        // that execution is refused after it closes.
        let expiry_window = Self::get_expiry_window(env);
        if expiry_window > 0 {
            let expires_at = execute_after
                .checked_add(expiry_window)
                .ok_or(TimeLockError::InvalidDelay)?;
            env.storage()
                .persistent()
                .set(&TimeLockDataKey::Expiry(action_id), &expires_at);
        }

        // Append to pending list
        let mut pending: Vec<u64> = env
            .storage()
            .instance()
            .get(&TimeLockDataKey::PendingList)
            .unwrap_or_else(|| Vec::new(env));

        if pending.len() >= MAX_PENDING {
            return Err(TimeLockError::PendingLimitReached);
        }

        pending.push_back(action_id);
        env.storage()
            .instance()
            .set(&TimeLockDataKey::PendingList, &pending);

        env.events().publish(
            (String::from_str(env, "TimeLockQueued"), action_id),
            (proposed_by.clone(), execute_after),
        );

        Ok(action_id)
    }

    /// Execute a queued action after its delay has elapsed.
    pub fn execute_action(
        env: &Env,
        caller: &Address,
        action_id: u64,
    ) -> Result<TimeLockEntry, TimeLockError> {
        caller.require_auth();

        let entry: TimeLockEntry = env
            .storage()
            .persistent()
            .get(&TimeLockDataKey::Entry(action_id))
            .ok_or(TimeLockError::NotFound)?;

        if entry.executed {
            return Err(TimeLockError::AlreadyExecuted);
        }
        if entry.cancelled {
            return Err(TimeLockError::AlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < entry.execute_after {
            return Err(TimeLockError::DelayNotElapsed);
        }

        // Reject execution once the operation's expiry window has closed:
        // the deadline itself is the last instant execution is allowed, so
        // reaching it means the operation has expired.
        if let Some(expires_at) = env
            .storage()
            .persistent()
            .get::<TimeLockDataKey, u64>(&TimeLockDataKey::Expiry(action_id))
        {
            if now >= expires_at {
                return Err(TimeLockError::OperationExpired);
            }
        }

        let updated = TimeLockEntry {
            executed: true,
            ..entry.clone()
        };

        env.storage()
            .persistent()
            .set(&TimeLockDataKey::Entry(action_id), &updated);

        // Remove from pending list and drop the now-irrelevant expiry record.
        Self::remove_from_pending(env, action_id);
        env.storage()
            .persistent()
            .remove(&TimeLockDataKey::Expiry(action_id));

        env.events().publish(
            (String::from_str(env, "TimeLockExecuted"), action_id),
            caller.clone(),
        );

        Ok(updated)
    }

    /// Cancel a queued action. Only the original proposer may cancel.
    pub fn cancel_action(
        env: &Env,
        caller: &Address,
        action_id: u64,
    ) -> Result<TimeLockEntry, TimeLockError> {
        caller.require_auth();

        let entry: TimeLockEntry = env
            .storage()
            .persistent()
            .get(&TimeLockDataKey::Entry(action_id))
            .ok_or(TimeLockError::NotFound)?;

        if entry.executed {
            return Err(TimeLockError::AlreadyExecuted);
        }
        if entry.cancelled {
            return Err(TimeLockError::AlreadyCancelled);
        }

        if entry.proposed_by != *caller {
            return Err(TimeLockError::Unauthorized);
        }

        let updated = TimeLockEntry {
            cancelled: true,
            ..entry.clone()
        };

        env.storage()
            .persistent()
            .set(&TimeLockDataKey::Entry(action_id), &updated);

        Self::remove_from_pending(env, action_id);
        env.storage()
            .persistent()
            .remove(&TimeLockDataKey::Expiry(action_id));

        env.events().publish(
            (String::from_str(env, "TimeLockCancelled"), action_id),
            caller.clone(),
        );

        Ok(updated)
    }

    /// Get all pending (non-executed, non-cancelled) timelock entries.
    pub fn get_pending_actions(env: &Env) -> Vec<TimeLockEntry> {
        let pending: Vec<u64> = env
            .storage()
            .instance()
            .get(&TimeLockDataKey::PendingList)
            .unwrap_or_else(|| Vec::new(env));

        let mut result = Vec::new(env);
        for id in pending.iter() {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<TimeLockDataKey, TimeLockEntry>(&TimeLockDataKey::Entry(id))
            {
                if !entry.executed && !entry.cancelled {
                    result.push_back(entry);
                }
            }
        }
        result
    }

    /// Get a specific timelock entry by ID.
    pub fn get_entry(env: &Env, action_id: u64) -> Option<TimeLockEntry> {
        env.storage()
            .persistent()
            .get(&TimeLockDataKey::Entry(action_id))
    }

    // --- Internal helpers ---

    fn remove_from_pending(env: &Env, action_id: u64) {
        let pending: Vec<u64> = env
            .storage()
            .instance()
            .get(&TimeLockDataKey::PendingList)
            .unwrap_or_else(|| Vec::new(env));

        let mut updated = Vec::new(env);
        for id in pending.iter() {
            if id != action_id {
                updated.push_back(id);
            }
        }
        env.storage()
            .instance()
            .set(&TimeLockDataKey::PendingList, &updated);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, Address) {
        let env = Env::default();
        let admin = Address::generate(&env);
        env.mock_all_auths();
        (env, admin)
    }

    #[test]
    fn test_queue_action() {
        let (env, admin) = setup();

        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::SetAdmin,
        )
        .unwrap();

        assert_eq!(action_id, 1);

        let entry = TimeLockManager::get_entry(&env, action_id).unwrap();
        assert_eq!(entry.action_type, ActionType::SetAdmin);
        assert!(!entry.executed);
        assert!(!entry.cancelled);
    }

    #[test]
    fn test_early_execution_rejected() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 3600).unwrap(); // 1 hour delay

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::SetAdmin,
        )
        .unwrap();

        let caller = Address::generate(&env);
        let result = TimeLockManager::execute_action(&env, &caller, action_id);

        assert_eq!(result, Err(TimeLockError::DelayNotElapsed));
    }

    #[test]
    fn test_successful_delayed_execution() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::ConfigUpdate(String::from_str(&env, "update_fees")),
        )
        .unwrap();

        // Advance ledger timestamp past the delay.
        env.ledger().set_timestamp(200);

        let caller = Address::generate(&env);
        let entry = TimeLockManager::execute_action(&env, &caller, action_id).unwrap();
        assert!(entry.executed);
        assert!(!entry.cancelled);

        // Verify removed from pending.
        let pending = TimeLockManager::get_pending_actions(&env);
        assert_eq!(pending.len(), 0);
    }

    #[test]
    fn test_cancellation() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::SetAdmin,
        )
        .unwrap();

        let entry = TimeLockManager::cancel_action(&env, &proposer, action_id).unwrap();
        assert!(entry.cancelled);
        assert!(!entry.executed);

        // Cannot execute a cancelled action.
        env.ledger().set_timestamp(200);
        let result = TimeLockManager::execute_action(&env, &proposer, action_id);
        assert_eq!(result, Err(TimeLockError::AlreadyCancelled));
    }

    #[test]
    fn test_non_proposer_cannot_cancel() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::SetAdmin,
        )
        .unwrap();

        let other = Address::generate(&env);
        let result = TimeLockManager::cancel_action(&env, &other, action_id);
        assert_eq!(result, Err(TimeLockError::Unauthorized));
    }

    #[test]
    fn test_cannot_execute_twice() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(
            &env,
            &proposer,
            ActionType::SetAdmin,
        )
        .unwrap();

        env.ledger().set_timestamp(200);
        let caller = Address::generate(&env);
        TimeLockManager::execute_action(&env, &caller, action_id).unwrap();

        let result = TimeLockManager::execute_action(&env, &caller, action_id);
        assert_eq!(result, Err(TimeLockError::AlreadyExecuted));
    }

    #[test]
    fn test_get_pending_actions_excludes_executed() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();

        let proposer = Address::generate(&env);
        let id1 = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();
        let id2 =
            TimeLockManager::queue_action(&env, &proposer, ActionType::SetUsdcContract).unwrap();

        assert_eq!(TimeLockManager::get_pending_actions(&env).len(), 2);

        env.ledger().set_timestamp(200);
        let caller = Address::generate(&env);
        TimeLockManager::execute_action(&env, &caller, id1).unwrap();

        let pending = TimeLockManager::get_pending_actions(&env);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending.get(0).unwrap().action_id, id2);
    }

    #[test]
    fn test_zero_delay_rejected() {
        let (env, admin) = setup();
        let result = TimeLockManager::set_delay(&env, &admin, 0);
        assert_eq!(result, Err(TimeLockError::InvalidDelay));
    }

    // -----------------------------------------------------------------------
    // C53 — Enforce timelock expiry
    // -----------------------------------------------------------------------

    #[test]
    fn test_expired_operation_cannot_execute() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        TimeLockManager::set_expiry_window(&env, &admin, 50).unwrap();

        let proposer = Address::generate(&env);
        // Both actions are queued at t=0: window is [100, 150).
        let action_id = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();
        let action2 = TimeLockManager::queue_action(&env, &proposer, ActionType::SetUsdcContract).unwrap();

        // Inside the window (t=120, still < 150) execution succeeds.
        env.ledger().set_timestamp(120);
        let caller = Address::generate(&env);
        assert!(TimeLockManager::execute_action(&env, &caller, action_id).is_ok());

        // After the window closes (t=200 >= 150) execution is rejected.
        let result = TimeLockManager::execute_action(&env, &caller, action2);
        assert_eq!(result, Err(TimeLockError::OperationExpired));
    }

    #[test]
    fn test_expired_operation_at_deadline_is_rejected() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        TimeLockManager::set_expiry_window(&env, &admin, 50).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();

        // At exactly expires_at (execute_after + window) execution is refused.
        env.ledger().set_timestamp(150);
        let caller = Address::generate(&env);
        let result = TimeLockManager::execute_action(&env, &caller, action_id);
        assert_eq!(result, Err(TimeLockError::OperationExpired));
    }

    #[test]
    fn test_inside_window_executes_once() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        TimeLockManager::set_expiry_window(&env, &admin, 50).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();

        // Execute just after the delay elapses, still inside the window.
        env.ledger().set_timestamp(101);
        let caller = Address::generate(&env);
        let entry = TimeLockManager::execute_action(&env, &caller, action_id).unwrap();
        assert!(entry.executed);

        // A second execution attempt fails — even inside the window.
        let result = TimeLockManager::execute_action(&env, &caller, action_id);
        assert_eq!(result, Err(TimeLockError::AlreadyExecuted));
    }

    #[test]
    fn test_cancellation_prevents_expired_execution() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        TimeLockManager::set_expiry_window(&env, &admin, 50).unwrap();

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();

        let entry = TimeLockManager::cancel_action(&env, &proposer, action_id).unwrap();
        assert!(entry.cancelled);

        // Later execution is refused whether inside or outside the window.
        env.ledger().set_timestamp(200);
        let result = TimeLockManager::execute_action(&env, &proposer, action_id);
        assert_eq!(result, Err(TimeLockError::AlreadyCancelled));
    }

    #[test]
    fn test_no_expiry_window_means_no_expiration() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        // No expiry window configured — defaults to 0.

        let proposer = Address::generate(&env);
        let action_id = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();

        // Far beyond any plausible window the operation still executes.
        env.ledger().set_timestamp(100_000);
        let caller = Address::generate(&env);
        let entry = TimeLockManager::execute_action(&env, &caller, action_id).unwrap();
        assert!(entry.executed);
    }

    #[test]
    fn test_expiry_record_removed_after_execution_and_cancellation() {
        let (env, admin) = setup();
        TimeLockManager::set_delay(&env, &admin, 100).unwrap();
        TimeLockManager::set_expiry_window(&env, &admin, 50).unwrap();

        let proposer = Address::generate(&env);
        let id1 = TimeLockManager::queue_action(&env, &proposer, ActionType::SetAdmin).unwrap();
        let id2 = TimeLockManager::queue_action(&env, &proposer, ActionType::SetUsdcContract).unwrap();
        let id3 = TimeLockManager::queue_action(&env, &proposer, ActionType::SetPauseConfig).unwrap();

        env.ledger().set_timestamp(120);
        let caller = Address::generate(&env);
        TimeLockManager::execute_action(&env, &caller, id1).unwrap();
        TimeLockManager::cancel_action(&env, &proposer, id2).unwrap();

        // id1 executed, id2 cancelled: their expiry records are cleared.
        assert!(!env.storage().persistent().has(&TimeLockDataKey::Expiry(id1)));
        assert!(!env.storage().persistent().has(&TimeLockDataKey::Expiry(id2)));
        // id3 is still pending, so its expiry record remains.
        assert!(env.storage().persistent().has(&TimeLockDataKey::Expiry(id3)));
    }
}
