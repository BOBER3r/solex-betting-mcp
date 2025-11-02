/**
 * Solana Betting Program Integration
 *
 * This module handles real transactions with the Sol Bets V3 Anchor program
 * Program ID: 4VqF8bf4SqsQdt9zxbSdxUGQYWjt9XmL6pxPdy7BRauF
 */

import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  TransactionSignature,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import IDL from '../sol_bets_v3.json' with { type: 'json' };

// ============================================================================
// Constants
// ============================================================================

export const BETTING_PROGRAM_ID = new PublicKey('4VqF8bf4SqsQdt9zxbSdxUGQYWjt9XmL6pxPdy7BRauF');
export const USDC_MINT_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// Betting limits
export const MIN_BET_SOL = new BN(5_000_000); // 0.005 SOL
export const MAX_BET_SOL = new BN('10000000000000000'); // 10M SOL
export const MIN_BET_USDC = new BN(1_000_000); // 1 USDC
export const MAX_BET_USDC = new BN('100000000000000'); // 100M USDC

// ============================================================================
// PDA Derivation Functions
// ============================================================================

/**
 * Derive the protocol PDA
 */
export function getProtocolPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('protocol')],
    BETTING_PROGRAM_ID
  );
}

/**
 * Derive the market PDA from market ID
 * @param marketId - The on-chain market ID (u64)
 */
export function getMarketPda(marketId: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market'), marketId.toArrayLike(Buffer, 'le', 8)],
    BETTING_PROGRAM_ID
  );
}

/**
 * Derive the user position PDA
 * @param marketPda - The market's public key
 * @param userPubkey - The user's public key
 */
export function getUserPositionPda(
  marketPda: PublicKey,
  userPubkey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_position'), marketPda.toBuffer(), userPubkey.toBuffer()],
    BETTING_PROGRAM_ID
  );
}

/**
 * Derive the market vault PDA (for SOL)
 * @param marketPda - The market's public key
 */
export function getMarketVaultPda(marketPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market_vault'), marketPda.toBuffer()],
    BETTING_PROGRAM_ID
  );
}

/**
 * Derive the market USDC vault PDA
 * @param marketPda - The market's public key
 */
export function getMarketUsdcVaultPda(marketPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('market_vault'), marketPda.toBuffer(), Buffer.from('usdc')],
    BETTING_PROGRAM_ID
  );
}

// ============================================================================
// Betting Functions
// ============================================================================

/**
 * Place a bet on a SOL market
 *
 * @param connection - Solana connection
 * @param wallet - Keypair of the bettor
 * @param marketAddress - On-chain address of the market
 * @param marketId - Market ID (from the Market account)
 * @param amountLamports - Bet amount in lamports
 * @param betYes - true for YES, false for NO
 * @returns Transaction signature
 */
export async function placeBetSol(
  connection: Connection,
  wallet: Keypair,
  marketAddress: string,
  marketId: number,
  amountLamports: string,
  betYes: boolean
): Promise<TransactionSignature> {
  console.error(`\n🎲 PLACING SOL BET`);
  console.error(`${'='.repeat(60)}`);
  console.error(`   Market Address: ${marketAddress}`);
  console.error(`   Market ID: ${marketId}`);
  console.error(`   Amount: ${parseFloat(amountLamports) / 1e9} SOL (${amountLamports} lamports)`);
  console.error(`   Side: ${betYes ? 'YES' : 'NO'}`);
  console.error(`   Wallet: ${wallet.publicKey.toString()}`);
  console.error(`${'='.repeat(60)}\n`);

  // Create Anchor provider and program
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(IDL as any, provider);

  // Convert inputs
  const marketPubkey = new PublicKey(marketAddress);
  const marketIdBN = new BN(marketId);
  const amount = new BN(amountLamports);

  // Validate amount
  if (amount.lt(MIN_BET_SOL)) {
    throw new Error(`Amount too small. Minimum: ${MIN_BET_SOL.toString()} lamports (0.005 SOL)`);
  }
  if (amount.gt(MAX_BET_SOL)) {
    throw new Error(`Amount too large. Maximum: ${MAX_BET_SOL.toString()} lamports`);
  }

  // Derive PDAs
  const [protocolPda] = getProtocolPda();
  const [userPositionPda] = getUserPositionPda(marketPubkey, wallet.publicKey);
  const [marketVaultPda] = getMarketVaultPda(marketPubkey);

  console.error(`📍 Derived PDAs:`);
  console.error(`   Protocol: ${protocolPda.toString()}`);
  console.error(`   User Position: ${userPositionPda.toString()}`);
  console.error(`   Market Vault: ${marketVaultPda.toString()}\n`);

  try {
    // Execute the instruction
    console.error(`📤 Sending transaction...`);
    const signature = await program.methods
      .placeBetSol(amount, betYes)
      .accounts({
        protocol: protocolPda,
        market: marketPubkey,
        userPosition: userPositionPda,
        user: wallet.publicKey,
        marketVault: marketVaultPda,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    console.error(`\n✅ BET PLACED SUCCESSFULLY!`);
    console.error(`${'='.repeat(60)}`);
    console.error(`   Signature: ${signature}`);
    console.error(`   🔍 View: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.error(`${'='.repeat(60)}\n`);

    return signature;
  } catch (error) {
    console.error(`\n❌ BET FAILED`);
    console.error(`${'='.repeat(60)}`);
    console.error(`   Error: ${error}`);
    console.error(`${'='.repeat(60)}\n`);
    throw error;
  }
}

/**
 * Place a bet on a USDC market
 *
 * @param connection - Solana connection
 * @param wallet - Keypair of the bettor
 * @param marketAddress - On-chain address of the market
 * @param marketId - Market ID (from the Market account)
 * @param amountMicroUsdc - Bet amount in micro-USDC (6 decimals)
 * @param betYes - true for YES, false for NO
 * @returns Transaction signature
 */
export async function placeBetUsdc(
  connection: Connection,
  wallet: Keypair,
  marketAddress: string,
  marketId: number,
  amountMicroUsdc: string,
  betYes: boolean
): Promise<TransactionSignature> {
  console.error(`\n🎲 PLACING USDC BET`);
  console.error(`${'='.repeat(60)}`);
  console.error(`   Market Address: ${marketAddress}`);
  console.error(`   Market ID: ${marketId}`);
  console.error(`   Amount: ${parseFloat(amountMicroUsdc) / 1e6} USDC (${amountMicroUsdc} micro-USDC)`);
  console.error(`   Side: ${betYes ? 'YES' : 'NO'}`);
  console.error(`   Wallet: ${wallet.publicKey.toString()}`);
  console.error(`${'='.repeat(60)}\n`);

  // Create Anchor provider and program
  const provider = new AnchorProvider(
    connection,
    new Wallet(wallet),
    { commitment: 'confirmed' }
  );
  const program = new Program(IDL as any, provider);

  // Convert inputs
  const marketPubkey = new PublicKey(marketAddress);
  const marketIdBN = new BN(marketId);
  const amount = new BN(amountMicroUsdc);

  // Validate amount
  if (amount.lt(MIN_BET_USDC)) {
    throw new Error(`Amount too small. Minimum: ${MIN_BET_USDC.toString()} micro-USDC (1 USDC)`);
  }
  if (amount.gt(MAX_BET_USDC)) {
    throw new Error(`Amount too large. Maximum: ${MAX_BET_USDC.toString()} micro-USDC`);
  }

  // Derive PDAs
  const [protocolPda] = getProtocolPda();
  const [userPositionPda] = getUserPositionPda(marketPubkey, wallet.publicKey);
  const [marketUsdcVaultPda] = getMarketUsdcVaultPda(marketPubkey);

  // Get user's USDC token account
  const userTokenAccount = getAssociatedTokenAddressSync(
    USDC_MINT_DEVNET,
    wallet.publicKey
  );

  console.error(`📍 Derived PDAs:`);
  console.error(`   Protocol: ${protocolPda.toString()}`);
  console.error(`   User Position: ${userPositionPda.toString()}`);
  console.error(`   Market USDC Vault: ${marketUsdcVaultPda.toString()}`);
  console.error(`   User Token Account: ${userTokenAccount.toString()}\n`);

  try {
    // Execute the instruction
    console.error(`📤 Sending transaction...`);
    const signature = await program.methods
      .placeBetUsdc(amount, betYes)
      .accounts({
        protocol: protocolPda,
        market: marketPubkey,
        userPosition: userPositionPda,
        user: wallet.publicKey,
        userTokenAccount: userTokenAccount,
        marketUsdcVault: marketUsdcVaultPda,
        usdcMint: USDC_MINT_DEVNET,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();

    console.error(`\n✅ BET PLACED SUCCESSFULLY!`);
    console.error(`${'='.repeat(60)}`);
    console.error(`   Signature: ${signature}`);
    console.error(`   🔍 View: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    console.error(`${'='.repeat(60)}\n`);

    return signature;
  } catch (error) {
    console.error(`\n❌ BET FAILED`);
    console.error(`${'='.repeat(60)}`);
    console.error(`   Error: ${error}`);
    console.error(`${'='.repeat(60)}\n`);
    throw error;
  }
}
