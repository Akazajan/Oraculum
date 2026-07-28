#![no_std]

//! Common types for Oraculum contracts.
//!
//! This crate provides shared enums and structs to ensure consistency
//! across all Oraculum smart contracts.

mod types;
pub mod canonicalization;
pub mod storage_version;

// Re-export all types
pub use types::{
    validate_attribute, validate_metadata, validate_page_params, AttendanceAction,
    AttendanceFrequency, DateRange, DayPattern, MembershipStatus, MetadataUpdate, MetadataValue,
    PageParams, PeakHourData, SubscriptionPlan, SubscriptionTier, TierChangeRequest,
    TierChangeStatus, TierChangeType, TierFeature, TierLevel, TierPromotion, TimePeriod,
    TokenMetadata, UserAttendanceStats, UserRole, MAX_ATTRIBUTES_COUNT, MAX_ATTRIBUTE_KEY_LENGTH,
    MAX_DESCRIPTION_LENGTH, MAX_PAGE_SIZE, MAX_TEXT_VALUE_LENGTH,
};
pub use storage_version::{StorageVersion, StorageVersionManager};

#[cfg(test)]
pub mod canonicalization;
mod test_contract;
