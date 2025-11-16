"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const registration_1 = require("../language/registration");
const showPrompter_1 = require("./commands/showPrompter");
function activate(context) {
    (0, registration_1.registerLanguageFeatures)(context);
    (0, showPrompter_1.registerShowPrompterCommand)(context);
}
function deactivate() {
    // No-op for now
}
//# sourceMappingURL=extension.js.map