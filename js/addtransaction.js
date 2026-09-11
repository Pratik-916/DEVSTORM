/**
 * addtransaction.js
 * Controls the Add Manual Transaction & Obligation modal:
 *   - Open/close the modal overlay
 *   - Type selector (Cash Sale / Cash Expense / Personal Withdrawal / Upcoming Obligation)
 *   - Switch between type-selector view and form view
 *   - Form field interactions (payment method, settlement toggle, type toggle)
 *   - On submit: saves manual entry to AppState and refreshes UI across all pages
 */

'use strict';

const AddTransaction = (() => {
  // DOM references (set in init)
  let overlay, typeScreen, formScreen;

  // Track the currently selected payment method
  let selectedMethod = 'cash';

  function open(initialType) {
    if (!overlay) return;
    overlay.classList.add('open');
    if (initialType) {
      showFormScreen(initialType);
    } else {
      showTypeScreen();
    }
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    resetForm();
  }

  function showTypeScreen() {
    typeScreen?.classList.remove('hidden');
    formScreen?.classList.add('hidden');
  }

  function showFormScreen(type) {
    typeScreen?.classList.add('hidden');
    formScreen?.classList.remove('hidden');

    const typeToggleGroup  = document.getElementById('form-group-type-toggle');
    const methodGroup      = document.getElementById('form-group-method');
    const settlementGroup  = document.getElementById('form-group-settlement');
    const dueDateGroup     = document.getElementById('form-group-due-date');
    const submitBtn        = document.getElementById('btn-add-transaction-submit');
    const catSelect        = document.getElementById('txn-category');
    const descInput        = document.getElementById('txn-description');
    const title            = document.getElementById('modal-form-title');

    // Default visibility
    if (typeToggleGroup) typeToggleGroup.style.display = '';
    if (methodGroup)     methodGroup.style.display = '';
    if (settlementGroup) settlementGroup.style.display = '';
    if (dueDateGroup)    dueDateGroup.classList.add('hidden');
    if (submitBtn)       submitBtn.textContent = 'Add Transaction';

    const titles = {
      sale: 'Record Cash Sale',
      expense: 'Record Cash Expense',
      withdrawal: 'Record Personal Withdrawal',
      payment: 'Add Upcoming Obligation',
    };
    if (title) title.textContent = titles[type] || 'Record Entry';

    const saleBtn    = document.getElementById('type-toggle-sale');
    const expenseBtn = document.getElementById('type-toggle-expense');

    if (type === 'sale') {
      if (saleBtn) saleBtn.classList.add('selected');
      if (expenseBtn) expenseBtn.classList.remove('selected');
      if (catSelect) catSelect.value = 'sales';
      if (descInput) descInput.placeholder = 'e.g. Counter cash sales, order note...';
    } else if (type === 'expense') {
      if (expenseBtn) expenseBtn.classList.add('selected');
      if (saleBtn) saleBtn.classList.remove('selected');
      if (catSelect) catSelect.value = 'stock';
      if (descInput) descInput.placeholder = 'e.g. Produce, shop supplies, transport...';
    } else if (type === 'withdrawal') {
      if (expenseBtn) expenseBtn.classList.add('selected');
      if (saleBtn) saleBtn.classList.remove('selected');
      if (typeToggleGroup) typeToggleGroup.style.display = 'none';
      if (catSelect) catSelect.value = 'personal';
      if (descInput) {
        descInput.value = 'Personal Withdrawal';
        descInput.placeholder = 'e.g. Owner personal drawing';
      }
    } else if (type === 'payment') {
      if (typeToggleGroup) typeToggleGroup.style.display = 'none';
      if (methodGroup) methodGroup.style.display = 'none';
      if (settlementGroup) settlementGroup.style.display = 'none';
      if (dueDateGroup) {
        dueDateGroup.classList.remove('hidden');
        const dueDateInput = document.getElementById('txn-due-date');
        if (dueDateInput && !dueDateInput.value) {
          dueDateInput.value = new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
        }
      }
      if (submitBtn) submitBtn.textContent = 'Add Obligation';
      if (catSelect) catSelect.value = 'supplier';
      if (descInput) descInput.placeholder = 'e.g. Supplier payment, shop rent...';
    }

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

    const expenseBtn = document.getElementById('type-toggle-expense');
    const isExpense  = (currentType === 'expense' || currentType === 'withdrawal') || (expenseBtn && expenseBtn.classList.contains('selected'));
    const type = isExpense ? 'expense' : 'sale';

    const amount      = parseFloat(document.getElementById('txn-amount')?.value) || 0;
    const category    = document.getElementById('txn-category')?.value || (currentType === 'withdrawal' ? 'personal' : 'other');
    let description   = document.getElementById('txn-description')?.value.trim();

    if (!description) {
      if (currentType === 'withdrawal') description = 'Personal Withdrawal';
      else if (type === 'sale') description = 'Cash Sale';
      else description = 'Cash Expense';
    }

    // Settlement status
    const settledBtn = document.getElementById('settle-settled');
    const settlementStatus = (settledBtn && settledBtn.classList.contains('selected-settled'))
      ? 'settled'
      : 'pending';

    const channel = currentType === 'withdrawal'
      ? 'Personal Drawing'
      : (selectedMethod === 'cash' ? 'Counter Cash' : 'Manual Entry');

    return {
      source: 'manual',
      type,
      amount,
      paymentMethod: selectedMethod,
      channel,
      settlementStatus,
      category,
      description,
    };
  }

  /** Collect data for an Upcoming Payment */
  function collectPaymentData() {
    const title       = document.getElementById('txn-description')?.value.trim() || 'Upcoming Obligation';
    const amount      = parseFloat(document.getElementById('txn-amount')?.value) || 0;
    const category    = document.getElementById('txn-category')?.value || 'other';
    const dueDateInput = document.getElementById('txn-due-date')?.value;
    const dueDate     = dueDateInput || new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10);
    return { title, amount, category, dueDate };
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
    document.getElementById('add-type-sale')?.addEventListener('click',       () => showFormScreen('sale'));
    document.getElementById('add-type-expense')?.addEventListener('click',    () => showFormScreen('expense'));
    document.getElementById('add-type-withdrawal')?.addEventListener('click', () => showFormScreen('withdrawal'));
    document.getElementById('add-type-payment')?.addEventListener('click',    () => showFormScreen('payment'));

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
      close();
      return;
    }

    if (currentType === 'payment') {
      // Save upcoming payment
      const data = collectPaymentData();
      AppState.addPayment(data);
      if (typeof AppState.refreshAllViews === 'function') {
        AppState.refreshAllViews();
      }
      showSuccess('Upcoming obligation added');
    } else {
      // Save transaction (cash sale, cash expense, withdrawal)
      const data = collectFormData();
      AppState.addTransaction(data);

      if (typeof AppState.refreshAllViews === 'function') {
        AppState.refreshAllViews();
      } else {
        if (typeof Transactions !== 'undefined' && typeof Transactions.render === 'function') Transactions.render();
        if (typeof Dashboard !== 'undefined' && typeof Dashboard.renderSummary === 'function') Dashboard.renderSummary();
        if (typeof Reports !== 'undefined' && typeof Reports.renderMetrics === 'function') Reports.renderMetrics();
      }

      showSuccess(currentType === 'withdrawal' ? 'Personal withdrawal recorded' : 'Transaction recorded');
    }

    close();
  }

  return { init, open, close };
})();

document.addEventListener('DOMContentLoaded', AddTransaction.init);
