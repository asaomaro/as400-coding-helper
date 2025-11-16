"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isParameterVisible = isParameterVisible;
function isParameterVisible(definition, hasExistingValue) {
    if (hasExistingValue) {
        return true;
    }
    if (definition.visibleByDefault === false) {
        return false;
    }
    return true;
}
//# sourceMappingURL=visibilityRules.js.map