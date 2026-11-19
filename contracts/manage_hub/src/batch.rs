// Allow deprecated events API until migration to #[contractevent] macro
#![allow(deprecated)]

use crate::errors::Error;
use crate::membership_token::MembershipTokenContract;
use crate::types::{
    BatchItemResult, BatchMintParams, BatchTransferParams, BatchUpdateParams,
};
use crate::validation::BatchValidator;
use soroban_sdk::{symbol_short, Env, Vec};

pub struct BatchModule;

/// Implementation of batch operations for the [`MembershipTokenContract`].
///
/// # Atomicity and per-item failure semantics
///
/// Batch processing deliberately distinguishes two tiers of failure so the
/// implementation and the API agree on what a failure means:
///
/// * **Invocation-level failures** — a batch-size violation
///   ([`BatchValidator::validate_batch_size`]) or an authorization/host failure
///   (for example a `require_auth` that traps) abort the whole call. Nothing is
///   persisted and no [`BatchItemResult`] is returned.
/// * **Per-item failures** — an individual entry that fails its own validation
///   (already-issued id, missing token, …) is *caught* and reported as a
///   [`BatchItemResult`] with `success == false` and a non-zero `error_code`.
///   Processing continues with the remaining entries and the call returns `Ok`.
///   Because a Soroban invocation commits as a unit, the entries that already
///   succeeded in the same call **are** persisted: a failed entry does not roll
///   back its siblings. `batch_update` is the exception: it is atomic and
///   fails the whole call if any item fails.
///
/// The returned vector always contains exactly one [`BatchItemResult`] per input
/// item, in input order, with `index` equal to the input position.
impl BatchModule {
    /// Rejects empty and oversized batches before any element is processed.
    pub fn check_batch_size(size: u32) -> Result<(), Error> {
        if size == 0 {
            return Err(Error::Unauthorized);
        }
        BatchValidator::validate_batch_size(size)
    }

    /// Mints multiple tokens in a single transaction.
    /// Requires admin authorization for each mint if issue_token requires it.
    pub fn batch_mint(env: Env, params_vec: Vec<BatchMintParams>) -> Result<Vec<BatchItemResult>, Error> {
        Self::check_batch_size(params_vec.len())?;

        let results =
            MembershipTokenContract::batch_issue_tokens(env.clone(), params_vec.clone())?;

        // Emit batch event for tracking and monitoring
        env.events().publish(
            (symbol_short!("bat_mint"),),
            (params_vec.len(), env.ledger().timestamp()),
        );

        Ok(results)
    }

    /// Transfers multiple tokens to different recipients in a single transaction.
    /// Requires authorization from each current token owner.
    pub fn batch_transfer(
        env: Env,
        params_vec: Vec<BatchTransferParams>,
    ) -> Result<Vec<BatchItemResult>, Error> {
        Self::check_batch_size(params_vec.len())?;

        let results =
            MembershipTokenContract::batch_transfer_tokens(env.clone(), params_vec.clone())?;

        env.events().publish(
            (symbol_short!("bat_xfr"),),
            (params_vec.len(), env.ledger().timestamp()),
        );

        Ok(results)
    }

    /// Updates metadata for multiple tokens in a single transaction.
    /// Requires authorization from each token owner (or admin).
    ///
    /// Atomic: if any item fails, the whole call returns that item's error so
    /// earlier items are rolled back instead of being left partially updated.
    pub fn batch_update(
        env: Env,
        params_vec: Vec<BatchUpdateParams>,
    ) -> Result<Vec<BatchItemResult>, Error> {
        Self::check_batch_size(params_vec.len())?;

        let results =
            MembershipTokenContract::batch_set_token_metadata(env.clone(), params_vec.clone())?;

        for result in results.iter() {
            if !result.success {
                return Err(Error::try_from(result.error_code).unwrap_or(Error::Unauthorized));
            }
        }

        env.events().publish(
            (symbol_short!("bat_upd"),),
            (params_vec.len(), env.ledger().timestamp()),
        );

        Ok(results)
    }
}
