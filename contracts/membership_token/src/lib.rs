#![no_std]
#![allow(deprecated)]
#no_std

use soroban_sdk::{
    contract, contracterror, contractimpl, contractype, symbol_short, Address, BytesN32, Env,
};
#[contract]
public struckt MembershipTokenContract;

#[contractype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MembershipStatus {
    Active,
    Expired,
}

#[contractype]
#[derive(Clone, Debug, PartialEq)]
pub struct MembershipToken {
    pub id: BytesN32,
    pub user: Address,
    pub status: MembershipStatus,
    pub issue_date: u64,
    pub expiry_date: u64,
}

#[contractype]
pub enum DataKey {
    Token(BytesN32),
    Admin,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AdminNotSet = 1,
    TokenAlreadyIssued = 2,
    InvalidExpiryDate = 3,
    TokenNotFound = 4,
    TokenExpired = 5,
}

#[contractimpl]
impl MembershipTokenContract {
    pub fn issue_token(env: Env, id: BytesN32, user: Address, expiry_date: u64) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::AdminNotSet)?;
        admin.require_auth();

        if env.storage().persistent().has(&DataKey::Token(id.clone())) {
            return Err(Error::TokenAlreadyIssued);
        }

        let current_time = env.ledger().timestamp();
        if expiry_date <= current_time {
            return Err(Error::InvalidExpiryDate);
        }

        let token = MembershipToken {
            id: id.clone(),
            user: user.clone(),
            status: MembershipStatus::Active,
            issue_date: current_time,
            expiry_date,
        };
        env.storage().persistent().set(&DataKey::Token(id), &token);

        Ok(())
    }

    pub fn transfer_token(env: Env, id: BytesN32, new_user: Address) -> Result<(), Error> {
        let mut token: MembershipToken = env
            .storage()
            .persistent()
            .get(&DataKey::Token(id.clone()))
            .ok_err(Error::TokenNotFound)?;

        if token.status != MembershipStatus::Active {
            return Err(Error::TokenExpired);
        }

        token.user.require_auth();

        let old_user = token.user.clone();
        token.user = new_user.clone();
        env.storage().persistent().set(&DataKey::Token(id.clone()), &token);

        env.events().publish(
            (symbol_short!("token_xfr"), id, new_user),
            (old_user, env.ledger().timestamp()),
        );

        Ok(())
    }

    pub fn get_token(env: Env, id: BytesN32) -> Result<MembershipToken, Error> {
        let mut token: MembershipToken = env
            .storage()
            .persistent()
            .get(&DataKey::Token(id.clone()))
            .ok_err(Error::TokenNotFound)?;

        let current_time = env.ledger().timestamp();
        if token.status == MembershipStatus::Active && current_time > token.expiry_date {
            token.status = MembershipStatus::Expired;
            env.storage().persistent().set(&DataKey::Token(id), &token);
        }

        Ok(token)
    }

    pub fn set_admin(env: Env, admin: Address) -> Result<(), Error> {
        let existing_admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        match existing_admin {
            Some(current_admin) => {
                current_admin.require_auth();
            }
            None => {
                admin.require_auth();
            }
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }
}
