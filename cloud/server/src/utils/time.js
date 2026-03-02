function parseTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
        const fromNumber = new Date(value);
        return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
    }
    if (typeof value === 'string') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            const fromNumeric = new Date(numeric);
            if (!Number.isNaN(fromNumeric.getTime())) {
                return fromNumeric;
            }
        }
        const fromString = new Date(value);
        return Number.isNaN(fromString.getTime()) ? null : fromString;
    }
    return null;
}

module.exports = {
    parseTimestamp
};
