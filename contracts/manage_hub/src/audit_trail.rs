//! Audit trail for protocol configuration changes.
//!
//! Records a bounded history of every configuration mutation so that
//! governance and compliance tooling can query the full change log.

use soroban_sdk::{contracttype, Address, Env, Map, String, Vec};

/// Maximum number of audit entries retained (circular buffer).
const MAX_AUDIT_ENTRIES: u32 = 200;

/// A single audit record.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AuditEntry {
    /// Ledger timestamp when the change was recorded
    pub timestamp: u64,
    /// Address that performed the change
    pub actor: Address,
    /// Classification of the change (e.g. "set_admin", "update_tier")
    pub action_type: String,
    /// Previous value (serialized) — `None` for creates
    pub old_value: Option<String>,
    /// New value (serialized)
    pub new_value: Option<String>,
    /// Arbitrary metadata (e.g. tier_id, subscription_id)
    pub metadata: Map<String, String>,
}

/// Storage keys for the audit trail.
#[contracttype]
pub enum AuditDataKey {
    /// Single entry by sequential index (circular buffer position)
    Entry(u32),
    /// Total number of entries ever written
    Count,
    /// Head index (next write position in the circular buffer)
    Head,
}

pub struct AuditTrail;

impl AuditTrail {
    /// Record a configuration change.
    pub fn record_change(
        env: &Env,
        actor: &Address,
        action_type: &str,
        old_value: Option<&str>,
        new_value: Option<&str>,
        metadata: &Map<String, String>,
    ) {
        let now = env.ledger().timestamp();
        let action_str = String::from_str(env, action_type);

        let old_str = old_value.map(|v| String::from_str(env, v));
        let new_str = new_value.map(|v| String::from_str(env, v));

        let entry = AuditEntry {
            timestamp: now,
            actor: actor.clone(),
            action_type: action_str,
            old_value: old_str,
            new_value: new_str,
            metadata: metadata.clone(),
        };

        let count: u32 = env
            .storage()
            .instance()
            .get(&AuditDataKey::Count)
            .unwrap_or(0);

        let head: u32 = env
            .storage()
            .instance()
            .get(&AuditDataKey::Head)
            .unwrap_or(0);

        // Write at head position.
        env.storage()
            .instance()
            .set(&AuditDataKey::Entry(head), &entry);

        // Advance head (circular buffer).
        let new_head = (head + 1) % MAX_AUDIT_ENTRIES;
        env.storage()
            .instance()
            .set(&AuditDataKey::Head, &new_head);

        // Increment count (capped at MAX_AUDIT_ENTRIES).
        let new_count = if count < MAX_AUDIT_ENTRIES {
            count + 1
        } else {
            MAX_AUDIT_ENTRIES
        };
        env.storage()
            .instance()
            .set(&AuditDataKey::Count, &new_count);

        env.events().publish(
            (String::from_str(env, "AuditRecorded"), action_type),
            actor.clone(),
        );
    }

    /// Get the full audit history (most recent first, up to `MAX_AUDIT_ENTRIES`).
    pub fn get_history(env: &Env) -> Vec<AuditEntry> {
        let count: u32 = env
            .storage()
            .instance()
            .get(&AuditDataKey::Count)
            .unwrap_or(0);

        let head: u32 = env
            .storage()
            .instance()
            .get(&AuditDataKey::Head)
            .unwrap_or(0);

        let mut result = Vec::new(env);

        if count == 0 {
            return result;
        }

        let len = if count < MAX_AUDIT_ENTRIES {
            count
        } else {
            MAX_AUDIT_ENTRIES
        };

        // Walk backwards from the most recent entry.
        let mut i = 0u32;
        while i < len {
            let idx = if head == 0 {
                // Wrap around: last written is at MAX_AUDIT_ENTRIES - 1
                // but since head is 0, count must be MAX_AUDIT_ENTRIES.
                // Most recent is at head - 1 = MAX_AUDIT_ENTRIES - 1,
                // but we iterate from head backwards.
                (MAX_AUDIT_ENTRIES + head + MAX_AUDIT_ENTRIES - 1 - i) % MAX_AUDIT_ENTRIES
            } else {
                (head + MAX_AUDIT_ENTRIES - 1 - i) % MAX_AUDIT_ENTRIES
            };

            if let Some(entry) = env
                .storage()
                .instance()
                .get::<AuditDataKey, AuditEntry>(&AuditDataKey::Entry(idx))
            {
                result.push_back(entry);
            }

            i += 1;
        }

        result
    }

    /// Get audit entries filtered by action type (most recent first).
    pub fn get_history_for_action(env: &Env, action_type: &str) -> Vec<AuditEntry> {
        let all = Self::get_history(env);
        let action_str = String::from_str(env, action_type);
        let mut filtered = Vec::new(env);

        for entry in all.iter() {
            if entry.action_type == action_str {
                filtered.push_back(entry);
            }
        }

        filtered
    }

    /// Get the most recent N audit entries.
    pub fn get_recent_changes(env: &Env, n: u32) -> Vec<AuditEntry> {
        let all = Self::get_history(env);
        let mut result = Vec::new(env);
        let mut count = 0u32;

        for entry in all.iter() {
            if count >= n {
                break;
            }
            result.push_back(entry);
            count += 1;
        }

        result
    }

    /// Get the total number of audit entries recorded.
    pub fn get_entry_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&AuditDataKey::Count)
            .unwrap_or(0)
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

    fn empty_metadata(env: &Env) -> Map<String, String> {
        Map::new(env)
    }

    #[test]
    fn test_record_and_get_history() {
        let (env, admin) = setup();

        let meta = empty_metadata(&env);
        AuditTrail::record_change(&env, &admin, "set_admin", None, Some("new_admin"), &meta);

        let history = AuditTrail::get_history(&env);
        assert_eq!(history.len(), 1);

        let entry = history.get(0).unwrap();
        assert_eq!(entry.action_type, String::from_str(&env, "set_admin"));
        assert_eq!(entry.old_value, None);
        assert_eq!(
            entry.new_value,
            Some(String::from_str(&env, "new_admin"))
        );
        assert_eq!(entry.actor, admin);
    }

    #[test]
    fn test_history_is_most_recent_first() {
        let (env, admin) = setup();
        let meta = empty_metadata(&env);

        AuditTrail::record_change(&env, &admin, "action_a", None, Some("v1"), &meta);
        AuditTrail::record_change(&env, &admin, "action_b", None, Some("v2"), &meta);

        let history = AuditTrail::get_history(&env);
        assert_eq!(history.len(), 2);

        // Most recent first.
        assert_eq!(
            history.get(0).unwrap().action_type,
            String::from_str(&env, "action_b")
        );
        assert_eq!(
            history.get(1).unwrap().action_type,
            String::from_str(&env, "action_a")
        );
    }

    #[test]
    fn test_get_history_for_action() {
        let (env, admin) = setup();
        let meta = empty_metadata(&env);

        AuditTrail::record_change(&env, &admin, "set_admin", None, Some("a"), &meta);
        AuditTrail::record_change(&env, &admin, "update_tier", Some("old"), Some("new"), &meta);
        AuditTrail::record_change(&env, &admin, "set_admin", Some("a"), Some("b"), &meta);

        let admin_history = AuditTrail::get_history_for_action(&env, "set_admin");
        assert_eq!(admin_history.len(), 2);

        let tier_history = AuditTrail::get_history_for_action(&env, "update_tier");
        assert_eq!(tier_history.len(), 1);
    }

    #[test]
    fn test_get_recent_changes() {
        let (env, admin) = setup();
        let meta = empty_metadata(&env);

        AuditTrail::record_change(&env, &admin, "a", None, None, &meta);
        AuditTrail::record_change(&env, &admin, "b", None, None, &meta);
        AuditTrail::record_change(&env, &admin, "c", None, None, &meta);

        let recent = AuditTrail::get_recent_changes(&env, 2);
        assert_eq!(recent.len(), 2);
        assert_eq!(
            recent.get(0).unwrap().action_type,
            String::from_str(&env, "c")
        );
        assert_eq!(
            recent.get(1).unwrap().action_type,
            String::from_str(&env, "b")
        );
    }

    #[test]
    fn test_circular_buffer_overwrite() {
        let (env, admin) = setup();
        let meta = empty_metadata(&env);

        // Fill beyond MAX_AUDIT_ENTRIES.
        let mut i = 0u32;
        while i < MAX_AUDIT_ENTRIES + 5 {
            let action = if i < MAX_AUDIT_ENTRIES {
                "old_fill"
            } else {
                "new_entry"
            };
            AuditTrail::record_change(&env, &admin, action, None, None, &meta);
            i += 1;
        }

        let count = AuditTrail::get_entry_count(&env);
        assert_eq!(count, MAX_AUDIT_ENTRIES);

        let history = AuditTrail::get_history(&env);
        assert_eq!(history.len(), MAX_AUDIT_ENTRIES);

        // The 5 most recent entries should be "new_entry".
        let mut new_count = 0u32;
        for entry in history.iter() {
            if entry.action_type == String::from_str(&env, "new_entry") {
                new_count += 1;
            }
        }
        assert_eq!(new_count, 5);
    }

    #[test]
    fn test_empty_history() {
        let env = Env::default();
        let history = AuditTrail::get_history(&env);
        assert_eq!(history.len(), 0);

        let count = AuditTrail::get_entry_count(&env);
        assert_eq!(count, 0);
    }

    #[test]
    fn test_metadata_preserved() {
        let (env, admin) = setup();

        let mut meta = Map::<String, String>::new(&env);
        meta.put(
            String::from_str(&env, "tier_id"),
            String::from_str(&env, "pro"),
        );
        meta.put(
            String::from_str(&env, "reason"),
            String::from_str(&env, "price_update"),
        );

        AuditTrail::record_change(
            &env,
            &admin,
            "update_tier",
            Some("old_price"),
            Some("new_price"),
            &meta,
        );

        let history = AuditTrail::get_history(&env);
        let entry = history.get(0).unwrap();
        assert_eq!(
            entry.metadata.get(String::from_str(&env, "tier_id")),
            Some(String::from_str(&env, "pro"))
        );
        assert_eq!(
            entry.metadata.get(String::from_str(&env, "reason")),
            Some(String::from_str(&env, "price_update"))
        );
    }
}
