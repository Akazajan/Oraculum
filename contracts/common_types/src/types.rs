// Event emitted when an agent's metadata is updated.
//
// # Fields
// * `agent_id` - Unique identifier of the agent (address)
// * `updater` - Address of the user who performed the update
// * `previous_version` - Metadata version before the update
// * `new_version` - Metadata version after the update
// * `timestamp` - When the update occurred
// * `new_metadata` - The metadata after the update
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentMetadataUpdatedEvent {
    /// Agent identifier (address)
    pub agent_id: Address,
    /// Address that performed the update
    pub updater: Address,
    /// Previous metadata version
    pub previous_version: u32,
    /// New metadata version
    pub new_version: u32,
    /// Update timestamp
    pub timestamp: u64,
    /// New metadata after the update
    pub new_metadata: TokenMetadata,
};