var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
var VITE_LOG = path.join(process.cwd(), 'vite.log');
var VITE_PORT = parseInt(process.env.VITE_PORT || '5173', 10);
/**
 * Finds and kills the process listening on the specified port.
 * This is more robust than relying on a PID file.
 */
function killProcessByPort(port) {
    try {
        // Find the PID of the process using the port. The -t flag returns only the PID.
        var pid = execSync("lsof -t -i :".concat(port)).toString().trim();
        if (pid) {
            console.log("[global-teardown] Found process ".concat(pid, " on port ").concat(port, ". Terminating..."));
            // Kill the process. Using -9 (SIGKILL) for simplicity in this environment.
            execSync("kill -9 ".concat(pid));
            console.log("[global-teardown] Process ".concat(pid, " terminated."));
        }
        else {
            console.log("[global-teardown] No process found on port ".concat(port, "."));
        }
    }
    catch (_a) {
        // lsof throws an error if no process is found, so we can ignore it.
        console.log("[global-teardown] No process found on port ".concat(port, " or an error occurred. Continuing cleanup."));
    }
}
export default function globalTeardown() {
    return __awaiter(this, void 0, void 0, function () {
        var lines, lastLines, PID_FILE;
        return __generator(this, function (_a) {
            console.log('[global-teardown] Starting robust cleanup...');
            killProcessByPort(VITE_PORT);
            // Print last 20 lines of vite.log if it exists
            if (fs.existsSync(VITE_LOG)) {
                console.log('--- Last 20 lines of vite.log (teardown) ---');
                lines = fs.readFileSync(VITE_LOG, 'utf-8').split('\n');
                lastLines = lines.slice(-20);
                lastLines.forEach(function (line) { return console.log(line); });
                console.log('--- End of vite.log ---');
            }
            PID_FILE = path.join(process.cwd(), '.vite.pid');
            if (fs.existsSync(PID_FILE)) {
                fs.unlinkSync(PID_FILE);
                console.log('[global-teardown] PID file cleaned up.');
            }
            console.log('[global-teardown] Finished robust cleanup.');
            return [2 /*return*/];
        });
    });
}
