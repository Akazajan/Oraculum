use soroban_sdk::IntoVal;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AdminNotSet = 1,
    TokenAlreadyIssued = 2,
    TokenNotFound = 3,
    Unauthorized = 4,
    TokenExpired = 5,
    InvalidExpiryDate = 6,
    InvalidEventDetails = 7,
    InvalidPaymentAmount = 8,
    InvalidPaymentToken = 9,
    SubscriptionNotFound = 10,
    UsdcContractNotSet = 11,
    AttendanceLogFailed = 12,
    SubscriptionAlreadyExists = 13,
    InsufficientBalance = 14,
    TimestampOverflow = 15,
    MetadataNotFound = 16,
    MetadataDescriptionTooLong = 17,
    MetadataTooManyAttributes = 18,
    MetadataAttributeKeyTooLong = 19,
    MetadataTextValueTooLong = 20,
    MetadataValidationFailed = 21,
    InvalidMetadataVersion = 22,
    InvalidPauseConfig = 23,
    SubscriptionPaused = 24,
    SubscriptionNotActive = 25,
    PauseCountExceeded = 26,
    PauseTooEarly = 27,
    SubscriptionNotPaused = 28,
    SubscriptionAlreadyRevoked = 51,
    SubscriptionInvalid = 52,
    InvalidDateRange = 29,
    NoAttendanceRecords = 30,
    IncompleteSession = 31,
    TierNotFound = 32,
    FeatureNotAvailable = 33,
    TierChangeAlreadyProcessed = 34,
    InvalidDiscountPercent = 35,
    InvalidPromoDateRange = 36,
    PromotionAlreadyExists = 37,
    PromotionNotFound = 38,
    PromoCodeExpired = 39,
    PromoCodeMaxRedemptions = 40,
    PromoCodeInvalid = 41,
    InvalidTierPrice = 42,
    TierAlreadyExists = 43,
    TierNotActive = 44,
    TierChangeNotFound = 45,
    RenewalNotAllowed = 46,
    TransferNotAllowedInGracePeriod = 47,
    GracePeriodExpired = 48,
    AutoRenewalFailed = 49,
    TokenFractionalized = 50,
    TierAlreadyActive = 53,
    TierAlreadyDeactivated = 54,
    StakingTierAlreadyActive = 55,
    StakingTierAlreadyDeactivated = 56,
    StakingTierNotFound = 57,
    InvalidPaginationParams = 58,
}

impl From<Error> for u32 {
    fn from(e: Error) -> u32 {
        e as u32
    }
}

impl TryFrom<u32> for Error {
    type Error = u32;
    fn try_from(v: u32) -> Result<Self, Self::Error> {
        match v {
            1 => Ok(Error::AdminNotSet),
            2 => Ok(Error::TokenAlreadyIssued),
            3 => Ok(Error::TokenNotFound),
            4 => Ok(Error::Unauthorized),
            5 => Ok(Error::TokenExpired),
            6 => Ok(Error::InvalidExpiryDate),
            7 => Ok(Error::InvalidEventDetails),
            8 => Ok(Error::InvalidPaymentAmount),
            9 => Ok(Error::InvalidPaymentToken),
            10 => Ok(Error::SubscriptionNotFound),
            11 => Ok(Error::UsdcContractNotSet),
            12 => Ok(Error::AttendanceLogFailed),
            13 => Ok(Error::SubscriptionAlreadyExists),
            14 => Ok(Error::InsufficientBalance),
            15 => Ok(Error::TimestampOverflow),
            16 => Ok(Error::MetadataNotFound),
            17 => Ok(Error::MetadataDescriptionTooLong),
            18 => Ok(Error::MetadataTooManyAttributes),
            19 => Ok(Error::MetadataAttributeKeyTooLong),
            20 => Ok(Error::MetadataTextValueTooLong),
            21 => Ok(Error::MetadataValidationFailed),
            22 => Ok(Error::InvalidMetadataVersion),
            23 => Ok(Error::InvalidPauseConfig),
            24 => Ok(Error::SubscriptionPaused),
            25 => Ok(Error::SubscriptionNotActive),
            26 => Ok(Error::PauseCountExceeded),
            27 => Ok(Error::PauseTooEarly),
            28 => Ok(Error::SubscriptionNotPaused),
            29 => Ok(Error::InvalidDateRange),
            30 => Ok(Error::NoAttendanceRecords),
            31 => Ok(Error::IncompleteSession),
            32 => Ok(Error::TierNotFound),
            33 => Ok(Error::FeatureNotAvailable),
            34 => Ok(Error::TierChangeAlreadyProcessed),
            35 => Ok(Error::InvalidDiscountPercent),
            36 => Ok(Error::InvalidPromoDateRange),
            37 => Ok(Error::PromotionAlreadyExists),
            38 => Ok(Error::PromotionNotFound),
            39 => Ok(Error::PromoCodeExpired),
            40 => Ok(Error::PromoCodeMaxRedemptions),
            41 => Ok(Error::PromoCodeInvalid),
            42 => Ok(Error::InvalidTierPrice),
            43 => Ok(Error::TierAlreadyExists),
            44 => Ok(Error::TierNotActive),
            45 => Ok(Error::TierChangeNotFound),
            46 => Ok(Error::RenewalNotAllowed),
            47 => Ok(Error::TransferNotAllowedInGracePeriod),
            48 => Ok(Error::GracePeriodExpired),
            49 => Ok(Error::AutoRenewalFailed),
            50 => Ok(Error::TokenFractionalized),
            51 => Ok(Error::SubscriptionAlreadyRevoked),
            52 => Ok(Error::SubscriptionInvalid),
            53 => Ok(Error::TierAlreadyActive),
            54 => Ok(Error::TierAlreadyDeactivated),
            55 => Ok(Error::StakingTierAlreadyActive),
            56 => Ok(Error::StakingTierAlreadyDeactivated),
            57 => Ok(Error::StakingTierNotFound),
            58 => Ok(Error::InvalidPaginationParams),
            _ => Err(v),
        }
    }
}

impl From<Error> for soroban_sdk::Error {
    fn from(e: Error) -> Self {
        soroban_sdk::Error::from_contract_error(u32::from(e))
    }
}

impl IntoVal<soroban_sdk::Env, soroban_sdk::Error> for Error {
    fn into_val(&self, _env: &soroban_sdk::Env) -> soroban_sdk::Error {
        soroban_sdk::Error::from_contract_error(u32::from(*self))
    }
    // -----------------------------------------------------------------
    // Tier / Staking Tier active state & listing gas-optimisation errors
    // (added for CT-15, CT-16, CT-17, CT-18)
    // -----------------------------------------------------------------
    /// Attempted to reactivate a tier that is already active.
    TierAlreadyActive = 51,
    /// Attempted to deactivate a tier that is already deactivated.
    TierAlreadyDeactivated = 52,
    /// Attempted to reactivate a staking tier that is already active.
    StakingTierAlreadyActive = 53,
    /// Attempted to deactivate a staking tier that is already deactivated.
    StakingTierAlreadyDeactivated = 54,
    /// Staking tier with the given ID does not exist (mirrors
    /// `TierNotFound` for the staking-tier namespace).
    StakingTierNotFound = 55,
    /// Pagination parameters failed validation (e.g. limit = 0,
    /// limit > MAX_PAGE_SIZE).
    InvalidPaginationParams = 56,
    /// Subscription has been marked as invalid.
    SubscriptionInvalid = 57,
}
