use crate::errors::Error;

/// Maximum number of operations allowed in a single batch to prevent gas limits or DoS
pub const MAX_BATCH_SIZE: u32 = 50;

pub struct BatchValidator;

impl BatchValidator {
    /// Validates that the batch size is within acceptable limits.
    ///
    /// An empty batch (size == 0) is allowed and returns `Ok` so callers
    /// get back an empty result list without a hard error.  A batch that
    /// exceeds `MAX_BATCH_SIZE` is still rejected.
    ///
    /// # Arguments
    /// * `size` - The number of items in the batch
    ///
    /// # Errors
    /// * `Unauthorized` - If size is greater than MAX_BATCH_SIZE
    pub fn validate_batch_size(size: u32) -> Result<(), Error> {
        if size > MAX_BATCH_SIZE {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
