/**
 * reconciliation.js
 * ============================================================
 * Cashly Data Quality & Reconciliation Engine — Phase 28
 *
 * Provides deterministic validation, idempotent duplicate detection,
 * hash-based change detection, and settled-transaction protection.
 * ============================================================
 */

'use strict';

const ReconciliationEngine = (() => {

  const RECONCILIATION_STATUS = {
    MATCHED: 'matched',
    AUTO_UPDATED: 'auto_updated',
    PENDING_REVIEW: 'pending_review',
    INVALID: 'invalid'
  };

  const SYNC_ACTION = {
    NEW: 'NEW',
    UNCHANGED: 'UNCHANGED',
    UPDATED: 'UPDATED',
    REQUIRES_REVIEW: 'REQUIRES_REVIEW',
    INVALID: 'INVALID'
  };

  /**
   * Validate that the transaction follows Cashly invariants.
   */
  function validateTransaction(txn) {
    if (!txn) return { valid: false, reason: 'Transaction is null' };
    
    // Amount must be a valid non-negative number
    if (typeof txn.amount !== 'number' || isNaN(txn.amount) || txn.amount < 0) {
      return { valid: false, reason: 'Invalid or negative amount' };
    }
    
    // Identity fields are required for provider transactions
    if (!txn.provider) return { valid: false, reason: 'Missing provider' };
    if (!txn.provider_account_id) return { valid: false, reason: 'Missing provider_account_id' };
    if (!txn.provider_transaction_id) return { valid: false, reason: 'Missing provider_transaction_id' };

    // Valid types
    if (!['sale', 'expense', 'withdrawal'].includes(txn.type)) {
      return { valid: false, reason: `Invalid transaction type: ${txn.type}` };
    }

    // Valid status
    if (!['pending', 'settled'].includes(txn.settlementStatus)) {
      return { valid: false, reason: `Invalid status: ${txn.settlementStatus}` };
    }

    // Valid date format (YYYY-MM-DD)
    if (!txn.date || !/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
      return { valid: false, reason: 'Invalid date format' };
    }

    return { valid: true };
  }

  /**
   * Generate a deterministic string hash based on canonical provider fields.
   */
  function generateTransactionHash(txn) {
    const fields = [
      txn.provider || '',
      txn.provider_account_id || '',
      txn.provider_transaction_id || '',
      txn.type || '',
      Number(txn.amount || 0).toFixed(2), // normalize amount
      txn.date || '',
      txn.settlementStatus || '',
      txn.currency || 'INR',
      String(txn.description || '').trim()
    ];
    
    const str = fields.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash).toString(36)}_${str.length}`;
  }

  /**
   * Reconcile a batch of incoming provider transactions against existing records.
   */
  function reconcileBatch(incomingBatch, existingTxns, account) {
    const result = {
      totalReceived: incomingBatch.length,
      imported: [],
      updated: [],
      skippedUnchanged: 0,
      invalid: [],
      requiresReview: [],
      duplicates: [],
      errors: [],
      timestamp: new Date().toISOString()
    };

    // Index existing transactions by composite identity and legacy reference
    const existingByIdentity = new Map();
    for (const t of existingTxns) {
      if (t.provider && t.provider_account_id && t.provider_transaction_id) {
        const key = `${t.provider}:${t.provider_account_id}:${t.provider_transaction_id}`;
        existingByIdentity.set(key, t);
      } else if (t.reference) {
        existingByIdentity.set(`legacy:${t.reference}`, t);
      }
    }

    const processedIncomingKeys = new Set();

    for (const txn of incomingBatch) {
      // 1. Validate
      const validation = validateTransaction(txn);
      if (!validation.valid) {
        result.invalid.push({ transaction: txn, reason: validation.reason });
        continue;
      }

      // 2. Enforce account/business consistency bounds
      if (account) {
        const isMatchedAccount = 
          txn.provider_account_id === account.provider_account_id || 
          txn.provider_account_id === account.external_account_id;
          
        if (!isMatchedAccount) {
          result.invalid.push({ transaction: txn, reason: 'Provider account mismatch' });
          continue;
        }
        if (txn.businessId && account.businessId && txn.businessId !== account.businessId) {
          result.invalid.push({ transaction: txn, reason: 'Business ownership violation' });
          continue;
        }
      }

      // 3. Duplicate check within the incoming batch
      const key = `${txn.provider}:${txn.provider_account_id}:${txn.provider_transaction_id}`;
      if (processedIncomingKeys.has(key)) {
        result.duplicates.push(txn);
        continue;
      }
      processedIncomingKeys.add(key);

      // 4. Compute deterministic content hash
      const incomingHash = generateTransactionHash(txn);
      txn.provider_sync_hash = incomingHash;
      txn.reconciliation_status = RECONCILIATION_STATUS.MATCHED;

      const legacyKey = txn.reference ? `legacy:${txn.reference}` : null;
      
      let existingMatch = existingByIdentity.get(key);
      if (!existingMatch && legacyKey) {
        existingMatch = existingByIdentity.get(legacyKey);
      }

      if (!existingMatch) {
        // NEW Transaction
        result.imported.push(txn);
      } else {
        // Existing Match
        const existingHash = existingMatch.provider_sync_hash || generateTransactionHash(existingMatch);
        
        if (incomingHash === existingHash) {
          // UNCHANGED — exact same content as what's already stored
          result.skippedUnchanged++;
        } else if (
          // Phase 29: incoming hash already matches the hash stored in pending_correction.
          // This means the provider re-sent the same correction that's already awaiting review.
          // Treat as UNCHANGED to prevent duplicate review creation.
          existingMatch.pending_correction &&
          existingMatch.pending_correction.provider_sync_hash === incomingHash
        ) {
          result.skippedUnchanged++;
        } else {
          // UPDATED Content Detected -> evaluate safety
          if (existingMatch.settlementStatus === 'settled') {
            // SETTLED PROTECTION: Never overwrite settled history automatically
            txn.reconciliation_status = RECONCILIATION_STATUS.PENDING_REVIEW;
            result.requiresReview.push({ 
              incoming: txn, 
              existing: existingMatch,
              reason: 'Cannot overwrite settled transaction'
            });
          } else {
            // Safe to AUTO_UPDATE unsettled transaction
            const safeUpdate = {
               ...existingMatch,             // Preserve local ID, created_at, category, manual edits
               amount: txn.amount,           // Accept provider amount
               type: txn.type,               // Accept provider type
               date: txn.date,               // Accept provider date
               settlementStatus: txn.settlementStatus, // Accept provider status
               description: txn.description, // Accept provider description
               provider_sync_hash: incomingHash,
               reconciliation_status: RECONCILIATION_STATUS.AUTO_UPDATED,
               updatedAt: new Date().toISOString()
            };
            
            result.updated.push(safeUpdate);
          }
        }
      }
    }

    return result;
  }

  return {
    validateTransaction,
    generateTransactionHash,
    reconcileBatch,
    RECONCILIATION_STATUS,
    SYNC_ACTION
  };
})();

if (typeof window !== 'undefined') {
  window.ReconciliationEngine = ReconciliationEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ReconciliationEngine;
}
