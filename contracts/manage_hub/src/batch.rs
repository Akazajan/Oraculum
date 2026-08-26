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

/// Implementation of batch operations for the MembershipTokenContract.
///
/// Each batch entry returns a [`BatchItemResult`]. Authorization and batch-size
/// checks still fail the whole call; per-item failures are reported individually
/// so callers know which index caused the problem without a full revert.
impl BatchModule {
    /// Mints multiple tokens in a single transaction.
    /// Requires admin authorization for each mint if issue_token requires it.
    pub fn batch_mint(env: Env, params_vec: Vec<BatchMintParams>) -> Result<Vec<BatchItemResult>, Error> {
        BatchValidator::validate_batch_size(params_vec.len())?;

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
        BatchValidator::validate_batch_size(params_vec.len())?;

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
    pub fn batch_update(
        env: Env,
        params_vec: Vec<BatchUpdateParams>,
    ) -> Result<Vec<BatchItemResult>, Error> {
        BatchValidator::validate_batch_size(params_vec.len())?;

        let results =
            MembershipTokenContract::batch_set_token_metadata(env.clone(), params_vec.clone())?;

        env.events().publish(
            (symbol_short!("bat_upd"),),
            (params_vec.len(), env.ledger().timestamp()),
        );

        Ok(results)
    }
}
