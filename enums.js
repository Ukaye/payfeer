let enums = {};

enums.USER = {
    STATUS: {
        INACTIVE: 0,
        ACTIVE: 1
    },
    TYPE: {
        ADMIN: 'admin',
        USER: 'user'
    },
    VERIFICATION: {
        PENDING: 0,
        VERIFIED: 1
    }
};

enums.WALLET_TRANSACTION = {
    STATUS: {
        APPROVED: 1,
        REVERSED: 0
    },
    REVERSAL: {
        TRUE: 1,
        FALSE: 0
    },
    TYPE: {
        CREDIT: 'credit',
        DEBIT: 'debit'
    },
    CATEGORY: {
        BANK_DEBIT: 'bank_withdrawal',
        BANK_CREDIT: 'bank_topup',
        TRANSFER_DEBIT: 'transfer_withdrawal',
        TRANSFER_CREDIT: 'transfer_topup',
        CARD_CREDIT: 'card_topup',
        REVERSAL: 'reversal',
        CHARGES: 'charges',
        VAT: 'vat'
    },
    CURRENCY: {
        NGN: "NGN",
        USD: "USD"
    }
};

enums.CARD = {
    STATUS: {
        INACTIVE: 0,
        ACTIVE: 1
    }
};

module.exports = enums;