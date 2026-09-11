/**
 * addtransaction.js
 * Controls the Add Transaction modal:
 *   - Open/close the modal overlay
 *   - Type selector (Sale / Expense / Upcoming Payment)
 *   - Switch between type-selector view and form view
 *   - Form field interactions (payment method, settlement toggle, type toggle)
 *   - On submit: saves to AppState and refreshes relevant UI
 */

'use strict';

const AddTransaction = (() => {
  // DOM references (set in init)
  let overlay, typeScreen, formScreen;

  // Track the currently selected payment method
  let selectedMethod = 'cash';

  function open() {
    overlay.classList.add('open');
    showTypeScreen();
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    resetForm();
  }

  function showTypeScreen() {
    typeScreen.classList.remove('hidden');
    formScreen.classList.add('hidden');
  }

  function showFormScreen(type) {
    typeScreen.classList.add('hidden');
    formScreen.classList.remove('hidden');

    // Set the form type toggle
    if (type === 'sale' || type === 'expense') {
      const saleBtn    = document.getElementById('type-toggle-sale');
      const expenseBtn = document.getElementById('type-toggle-expense');
      if (saleBtn && expenseBtn) {
        saleBtn.classList.toggle('selected', type === 'sale');
        expenseBtn.classList.toggle('selected', type === 'expense');
      }
    }

    // Update modal title
    const title = document.getElementById('modal-form-title');
    if (title) {
      const titles = {
        sale: 'Record a Sale',
        expense: 'Record an Expense',
        payment: 'Add Upcoming Payment',
      };
      title.textContent = titles[type] || 'Add Transaction';
    }

    // Store the selected type on the form
    if (formScreen) formScreen.dataset.currentType = type;
  }

  /** Reset form fields to defaults */
  function resetForm() {
    const amountInput = document.getElementById('txn-amount');
    if (amountInput) amountInput.value = '';

    const descInput = document.getElementById('txn-description');
    if (descInput) descInput.value = '';

    const catSelect = document.getElementById('txn-category');
    if (catSelect) catSelect.value = '';

    // Reset payment method to cash
    selectedMethod = 'cash';
    document.querySelectorAll('.method-btn').forEach((btn, i) => {
      btn.classList.toggle('selected', i === 0);
    });

    // Reset settlement to settled
    const settledBtn = document.getElementById('settle-settled');
    const pendingBtn = document.getElementById('settle-pending');
    if (settledBtn) {
      settledBtn.classList.add('selected-settled');
      settledBtn.classList.remove('selected-pending');
    }
    if (pendingBtn) {
      pendingBtn.classList.remove('selected-pending', 'selected-settled');
    }

    // Reset type toggle to sale
    const saleBtn    = document.getElementById('type-toggle-sale');
    const expenseBtn = document.getElementById('type-toggle-expense');
    if (saleBtn)    saleBtn.classList.add('selected');
    if (expenseBtn) expenseBtn.classList.remove('selected');
  }

  /** Read form values and build a transaction object */
  function collectFormData() {
    const currentType = formScreen?.dataset.currentType || 'sale';

    // Determine type from toggle if user changed it
    const expenseBtn = document.getElementById('type-toggle-expense');
    const isExpense  = expenseBtn && expenseBtn.classList.contains('selected');
    const type = (currentType === 'expense' || isExpense)
      ? 'expense'
      : 'sale';

    const amount      = parseFloat(document.getElementById('txn-amount')?.value) || 0;
    const category    = document.getElementById('txn-category')?.value || 'other';
    const description = document.getElementById('txn-description')?.value.trim() || '';

    // Settlement status
    const settledBtn = document.getElementById('settle-settled');
    const settlementStatus = (settledBtn && settledBtn.classList.contains('selected-settled'))
      ? 'settled'
      : 'pending';

    return { type, amount, paymentMethod: selectedMethod, settlementStatus, category, description };
  }

  /** Collect data for an Upcoming Payment */
  function collectPaymentData() {
    const title       = document.getElementById('txn-description')?.value.trim() || 'Payment';
    const amount      = parseFloat(document.getElementById('txn-amount')?.value) || 0;
    const category    = document.getElementById('txn-category')?.value || 'other';
    return { title, amount, category };
  }

  /** Show a brief inline confirmation message */
  function showSuccess(message) {
    const existing = document.getElementById('modal-success-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'modal-success-toast';
    toast.style.cssText = [
      'position:fixed',
      'bottom:24px',
      'left:50%',
      'transform:translateX(-50%)',
      'background:#0F172A',
      'color:#F1F5F9',
      'font-size:14px',
      'font-weight:500',
      'padding:12px 20px',
      'border-radius:10px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.2)',
      'z-index:9999',
      'white-space:nowrap',
      'font-family:Inter,sans-serif',
    ].join(';');
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  function initPaymentMethodBtns() {
    const methodMap = { 0: 'cash', 1: 'upi', 2: 'card', 3: 'bank_transfer', 4: 'credit' };

    document.querySelectorAll('.method-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedMethod = methodMap[i] || 'cash';
      });
    });
  }

  function initSettlementToggle() {
    const settledBtn = document.getElementById('settle-settled');
    const pendingBtn = document.getElementById('settle-pending');
    if (!settledBtn || !pendingBtn) return;

    settledBtn.addEventListener('click', () => {
      settledBtn.classList.add('selected-settled');
      settledBtn.classList.remove('selected-pending');
      pendingBtn.classList.remove('selected-pending', 'selected-settled');
    });

    pendingBtn.addEventListener('click', () => {
      pendingBtn.classList.add('selected-pending');
      pendingBtn.classList.remove('selected-settled');
      settledBtn.classList.remove('selected-settled', 'selected-pending');
    });
  }

  function initTypeToggle() {
    const saleBtn    = document.getElementById('type-toggle-sale');
    const expenseBtn = document.getElementById('type-toggle-expense');
    if (!saleBtn || !expenseBtn) return;

    saleBtn.addEventListener('click', () => {
      saleBtn.classList.add('selected');
      expenseBtn.classList.remove('selected');
    });

    expenseBtn.addEventListener('click', () => {
      expenseBtn.classList.add('selected');
      saleBtn.classList.remove('selected');
    });
  }

  function init() {
    overlay    = document.getElementById('modal-overlay');
    typeScreen = document.getElementById('modal-type-screen');
    formScreen = document.getElementById('modal-form-screen');

    if (!overlay) return;

    // Open modal buttons
    document.getElementById('btn-mobile-add')?.addEventListener('click', open);
    document.getElementById('btn-header-add')?.addEventListener('click', open);
    document.getElementById('btn-header-add-payment')?.addEventListener('click', open);

    // Close buttons
    document.getElementById('modal-type-close')?.addEventListener('click', close);
    document.getElementById('modal-form-close')?.addEventListener('click', close);
    document.getElementById('modal-form-back')?.addEventListener('click', showTypeScreen);

    // Close on backdrop click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });

    // Type selector
    document.getElementById('add-type-sale')?.addEventListener('click',    () => showFormScreen('sale'));
    document.getElementById('add-type-expense')?.addEventListener('click', () => showFormScreen('expense'));
    document.getElementById('add-type-payment')?.addEventListener('click', () => showFormScreen('payment'));

    // Form interactions
    initPaymentMethodBtns();
    initSettlementToggle();
    initTypeToggle();

    // Submit
    document.getElementById('btn-add-transaction-submit')?.addEventListener('click', handleSubmit);
  }

  /** Handle form submission — save to AppState, refresh UI, close */
  function handleSubmit() {
    const currentType = formScreen?.dataset.currentType || 'sale';

    // Validate amount
    const amountInput = document.getElementById('txn-amount');
    const amount = parseFloat(amountInput?.value) || 0;
    if (amount <= 0) {
      amountInput?.focus();
      amountInput?.style && (amountInput.style.borderColor = '#EF4444');
      setTimeout(() => {
        if (amountInput) amountInput.style.borderColor = '';
      }, 1500);
      return;
    }

    if (typeof AppState === 'undefined') {
      // AppState not available — just close
      close();
      return;
    }

    if (currentType === 'payment') {
      // Save upcoming payment
      const data = collectPaymentData();
      AppState.addPayment(data);
      showSuccess('Upcoming payment added');
    } else {
      // Save transaction (sale or expense)
      const data = collectFormData();
      AppState.addTransaction(data);

      // Refresh the transactions page list if it's rendered
      if (typeof Transactions !== 'undefined' && typeof Transactions.render === 'function') {
        Transactions.render();
      }

      // Refresh dashboard metrics if dashboard is active
      if (typeof Dashboard !== 'undefined' && typeof Dashboard.renderSummary === 'function') {
        Dashboard.renderSummary();
      }

      showSuccess('Transaction recorded');
    }

    close();
  }

  return { init, open, close };
})();

document.addEventListener('DOMContentLoaded', AddTransaction.init);
