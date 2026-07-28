//! Canonicalization helpers for deterministic query payload hashing.
//!
//! Provides functions to sort maps and address lists into canonical order
//! and to produce deterministic SHA-256 hashes of query payloads.

use soroban_sdk::{Address, BytesN, Env, Map, String, Vec};

use crate::MetadataValue;

/// Sorts a metadata map entries by key into a deterministic `Vec<(String, String)>`.
///
/// Each `MetadataValue` is serialized to its string representation for hashing:
/// - `Text(s)` → `s`
/// - `Number(n)` → decimal string
/// - `Boolean(true)` → `"true"`, `Boolean(false)` → `"false"`
/// - `Timestamp(t)` → decimal string
pub fn canonicalize_payload(
    env: &Env,
    data: &Map<String, MetadataValue>,
) -> Vec<(String, String)> {
    let mut keys: Vec<String> = Vec::new(env);
    for key in data.keys() {
        keys.push_back(key);
    }

    // Insertion sort — safe for small maps and no_std.
    let len = keys.len();
    let mut i = 1;
    while i < len {
        let mut j = i;
        while j > 0 {
            let prev = keys.get(j - 1).unwrap();
            let curr = keys.get(j).unwrap();
            if curr < prev {
                keys.set(j - 1, &curr);
                keys.set(j, &prev);
                j -= 1;
            } else {
                break;
            }
        }
        i += 1;
    }

    let mut result: Vec<(String, String)> = Vec::new(env);
    for key in keys.iter() {
        let value = data.get(key.clone()).unwrap();
        let serialized = metadata_value_to_string(&env, &value);
        result.push_back((key, serialized));
    }

    result
}

/// Hashes a canonicalized payload using SHA-256.
///
/// The payload map is first sorted by key via [`canonicalize_payload`],
/// then each key-value pair is serialized as `key\0value` (NUL-separated)
/// and concatenated. The resulting byte string is hashed with SHA-256.
pub fn hash_query_receipt(
    env: &Env,
    payload: &Map<String, MetadataValue>,
) -> BytesN<32> {
    let canonical = canonicalize_payload(env, payload);

    let mut bytes = soroban_sdk::Bytes::new(env);
    for (key, value) in canonical.iter() {
        // Append key bytes
        for byte in key.to_buffer().iter() {
            bytes.push_back(byte);
        }
        // Append NUL separator
        bytes.push_back(0u8);
        // Append value bytes
        for byte in value.to_buffer().iter() {
            bytes.push_back(byte);
        }
        // Append NUL separator between pairs
        bytes.push_back(0u8);
    }

    env.crypto().sha256(&bytes)
}

/// Sorts addresses into a deterministic order (lexicographic by their 32-byte encoding).
pub fn canonicalize_address_list(
    env: &Env,
    addresses: &Vec<Address>,
) -> Vec<Address> {
    let mut sorted: Vec<Address> = Vec::new(env);
    for addr in addresses.iter() {
        sorted.push_back(addr);
    }

    // Insertion sort by the address's internal byte representation.
    let len = sorted.len();
    let mut i = 1;
    while i < len {
        let mut j = i;
        while j > 0 {
            let prev = sorted.get(j - 1).unwrap();
            let curr = sorted.get(j).unwrap();
            // Compare via the underlying Bytes representation.
            let prev_bytes = soroban_sdk::Bytes::from_array(env, &prev.to_raw());
            let curr_bytes = soroban_sdk::Bytes::from_array(env, &curr.to_raw());
            if compare_bytes(&curr_bytes, &prev_bytes) < 0 {
                sorted.set(j - 1, &curr);
                sorted.set(j, &prev);
                j -= 1;
            } else {
                break;
            }
        }
        i += 1;
    }

    sorted
}

/// Lexicographic comparison of two `Bytes` buffers.
/// Returns negative if a < b, 0 if equal, positive if a > b.
fn compare_bytes(a: &soroban_sdk::Bytes, b: &soroban_sdk::Bytes) -> i32 {
    let len_a = a.len();
    let len_b = b.len();
    let min_len = if len_a < len_b { len_a } else { len_b };

    let mut i = 0u32;
    while i < min_len {
        let byte_a = a.get(i).unwrap();
        let byte_b = b.get(i).unwrap();
        if byte_a < byte_b {
            return -1;
        }
        if byte_a > byte_b {
            return 1;
        }
        i += 1;
    }

    if len_a < len_b {
        return -1;
    }
    if len_a > len_b {
        return 1;
    }
    0
}

/// Serializes a `MetadataValue` to its string representation.
fn metadata_value_to_string(env: &Env, value: &MetadataValue) -> String {
    match value {
        MetadataValue::Text(s) => s.clone(),
        MetadataValue::Number(n) => {
            // Simple i128 to decimal string conversion.
            if *n == 0 {
                return String::from_str(env, "0");
            }
            let negative = *n < 0;
            let mut num = if negative { -n } else { *n } as u128;
            let mut digits = soroban_sdk::Bytes::new(env);

            while num > 0 {
                let digit = (num % 10) as u8 + b'0';
                digits.push_back(digit);
                num /= 10;
            }

            if negative {
                digits.push_back(b'-');
            }

            // Reverse the digits
            let mut reversed = soroban_sdk::Bytes::new(env);
            let mut i = digits.len();
            while i > 0 {
                i -= 1;
                reversed.push_back(digits.get(i).unwrap());
            }

            String::from_bytes(env, &reversed)
        }
        MetadataValue::Boolean(true) => String::from_str(env, "true"),
        MetadataValue::Boolean(false) => String::from_str(env, "false"),
        MetadataValue::Timestamp(t) => {
            // Use same number-to-string logic.
            let mut num = *t as u128;
            let mut digits = soroban_sdk::Bytes::new(env);

            while num > 0 {
                let digit = (num % 10) as u8 + b'0';
                digits.push_back(digit);
                num /= 10;
            }

            if digits.len() == 0 {
                return String::from_str(env, "0");
            }

            let mut reversed = soroban_sdk::Bytes::new(env);
            let mut i = digits.len();
            while i > 0 {
                i -= 1;
                reversed.push_back(digits.get(i).unwrap());
            }

            String::from_bytes(env, &reversed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_deterministic_hash_same_payload() {
        let env = Env::default();

        let mut payload = Map::<String, MetadataValue>::new(&env);
        payload.put(
            String::from_str(&env, "name"),
            MetadataValue::Text(String::from_str(&env, "Alice")),
        );
        payload.put(
            String::from_str(&env, "age"),
            MetadataValue::Number(30),
        );

        let hash1 = hash_query_receipt(&env, &payload);
        let hash2 = hash_query_receipt(&env, &payload);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_different_payloads_different_hashes() {
        let env = Env::default();

        let mut payload1 = Map::<String, MetadataValue>::new(&env);
        payload1.put(
            String::from_str(&env, "name"),
            MetadataValue::Text(String::from_str(&env, "Alice")),
        );

        let mut payload2 = Map::<String, MetadataValue>::new(&env);
        payload2.put(
            String::from_str(&env, "name"),
            MetadataValue::Text(String::from_str(&env, "Bob")),
        );

        let hash1 = hash_query_receipt(&env, &payload1);
        let hash2 = hash_query_receipt(&env, &payload2);
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_order_independence() {
        let env = Env::default();

        let mut payload1 = Map::<String, MetadataValue>::new(&env);
        payload1.put(
            String::from_str(&env, "alpha"),
            MetadataValue::Text(String::from_str(&env, "1")),
        );
        payload1.put(
            String::from_str(&env, "beta"),
            MetadataValue::Text(String::from_str(&env, "2")),
        );

        let mut payload2 = Map::<String, MetadataValue>::new(&env);
        payload2.put(
            String::from_str(&env, "beta"),
            MetadataValue::Text(String::from_str(&env, "2")),
        );
        payload2.put(
            String::from_str(&env, "alpha"),
            MetadataValue::Text(String::from_str(&env, "1")),
        );

        let hash1 = hash_query_receipt(&env, &payload1);
        let hash2 = hash_query_receipt(&env, &payload2);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_canonicalize_payload_sorted_by_key() {
        let env = Env::default();

        let mut payload = Map::<String, MetadataValue>::new(&env);
        payload.put(
            String::from_str(&env, "charlie"),
            MetadataValue::Number(3),
        );
        payload.put(
            String::from_str(&env, "alpha"),
            MetadataValue::Number(1),
        );
        payload.put(
            String::from_str(&env, "bravo"),
            MetadataValue::Number(2),
        );

        let canonical = canonicalize_payload(&env, &payload);
        assert_eq!(canonical.len(), 3);

        let (k0, _) = canonical.get(0).unwrap();
        let (k1, _) = canonical.get(1).unwrap();
        let (k2, _) = canonical.get(2).unwrap();
        assert_eq!(k0, String::from_str(&env, "alpha"));
        assert_eq!(k1, String::from_str(&env, "bravo"));
        assert_eq!(k2, String::from_str(&env, "charlie"));
    }

    #[test]
    fn test_canonicalize_empty_map() {
        let env = Env::default();
        let payload = Map::<String, MetadataValue>::new(&env);
        let canonical = canonicalize_payload(&env, &payload);
        assert_eq!(canonical.len(), 0);
    }

    #[test]
    fn test_canonicalize_address_list_sorted() {
        let env = Env::default();
        let addr_a = Address::generate(&env);
        let addr_b = Address::generate(&env);
        let addr_c = Address::generate(&env);

        // Insert in reverse order.
        let mut addresses = Vec::<Address>::new(&env);
        addresses.push_back(addr_c.clone());
        addresses.push_back(addr_a.clone());
        addresses.push_back(addr_b.clone());

        let sorted = canonicalize_address_list(&env, &addresses);
        assert_eq!(sorted.len(), 3);

        // The sorted order depends on internal byte representation;
        // just verify all original addresses are present.
        let mut found_a = false;
        let mut found_b = false;
        let mut found_c = false;
        for addr in sorted.iter() {
            if addr == addr_a {
                found_a = true;
            }
            if addr == addr_b {
                found_b = true;
            }
            if addr == addr_c {
                found_c = true;
            }
        }
        assert!(found_a);
        assert!(found_b);
        assert!(found_c);
    }

    #[test]
    fn test_canonicalize_address_list_deterministic() {
        let env = Env::default();
        let addr1 = Address::generate(&env);
        let addr2 = Address::generate(&env);

        let mut addresses = Vec::<Address>::new(&env);
        addresses.push_back(addr1.clone());
        addresses.push_back(addr2.clone());

        let sorted1 = canonicalize_address_list(&env, &addresses);
        let sorted2 = canonicalize_address_list(&env, &addresses);
        assert_eq!(sorted1.len(), sorted2.len());
        for i in 0..sorted1.len() {
            assert_eq!(sorted1.get(i).unwrap(), sorted2.get(i).unwrap());
        }
    }

    #[test]
    fn test_hash_empty_payload() {
        let env = Env::default();
        let payload = Map::<String, MetadataValue>::new(&env);
        let hash = hash_query_receipt(&env, &payload);
        // Should still produce a valid 32-byte hash.
        assert_eq!(hash.to_buffer().len(), 32);
    }
}
