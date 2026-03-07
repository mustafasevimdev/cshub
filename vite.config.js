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
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
var YOUTUBE_SEARCH_BASE = 'https://www.youtube.com/results?hl=tr&persist_hl=1&search_query=';
var SEARCH_TIMEOUT_MS = 3000;
var searchCache = new Map();
var extractFirstYouTubeVideoId = function (value) {
    var patterns = [
        /https?:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
        /watch\?v=([A-Za-z0-9_-]{11})/i,
        /"videoId":"([A-Za-z0-9_-]{11})"/i,
    ];
    for (var _i = 0, patterns_1 = patterns; _i < patterns_1.length; _i++) {
        var pattern = patterns_1[_i];
        var match = value.match(pattern);
        if (match === null || match === void 0 ? void 0 : match[1]) {
            return match[1];
        }
    }
    return null;
};
var extractFirstYouTubeTitle = function (value) {
    var headingMatch = value.match(/### \[(.+?)\]\(http:\/\/www\.youtube\.com\/watch\?v=/i);
    if (headingMatch === null || headingMatch === void 0 ? void 0 : headingMatch[1]) {
        return headingMatch[1];
    }
    var titleMatch = value.match(/"title":\{"runs":\[\{"text":"(.+?)"/i);
    if (titleMatch === null || titleMatch === void 0 ? void 0 : titleMatch[1]) {
        return titleMatch[1];
    }
    return undefined;
};
export default defineConfig({
    plugins: [
        react(),
        {
            name: 'youtube-search-dev-endpoint',
            configureServer: function (server) {
                var _this = this;
                server.middlewares.use('/api/youtube/search', function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                    var requestUrl, query, cacheKey, cached, controller_1, timeout, response, payload, videoId, result, error_1;
                    var _a, _b;
                    return __generator(this, function (_c) {
                        switch (_c.label) {
                            case 0:
                                requestUrl = new URL((_a = req.url) !== null && _a !== void 0 ? _a : '/', 'http://localhost:3000');
                                query = (_b = requestUrl.searchParams.get('q')) === null || _b === void 0 ? void 0 : _b.trim();
                                if (!query) {
                                    res.statusCode = 400;
                                    res.setHeader('Content-Type', 'application/json');
                                    res.end(JSON.stringify({ error: 'Missing search query.' }));
                                    return [2 /*return*/];
                                }
                                _c.label = 1;
                            case 1:
                                _c.trys.push([1, 7, , 8]);
                                cacheKey = query.toLocaleLowerCase('tr-TR');
                                cached = searchCache.get(cacheKey);
                                if (cached) {
                                    res.statusCode = 200;
                                    res.setHeader('Content-Type', 'application/json');
                                    res.end(JSON.stringify(cached));
                                    return [2 /*return*/];
                                }
                                controller_1 = new AbortController();
                                timeout = setTimeout(function () { return controller_1.abort(); }, SEARCH_TIMEOUT_MS);
                                response = void 0;
                                _c.label = 2;
                            case 2:
                                _c.trys.push([2, , 4, 5]);
                                return [4 /*yield*/, fetch("".concat(YOUTUBE_SEARCH_BASE).concat(encodeURIComponent(query)), {
                                        headers: {
                                            'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
                                            'user-agent': 'Mozilla/5.0',
                                        },
                                        signal: controller_1.signal,
                                    })];
                            case 3:
                                response = _c.sent();
                                return [3 /*break*/, 5];
                            case 4:
                                clearTimeout(timeout);
                                return [7 /*endfinally*/];
                            case 5:
                                if (!response.ok) {
                                    res.statusCode = response.status;
                                    res.setHeader('Content-Type', 'application/json');
                                    res.end(JSON.stringify({ error: 'Search provider failed.' }));
                                    return [2 /*return*/];
                                }
                                return [4 /*yield*/, response.text()];
                            case 6:
                                payload = _c.sent();
                                videoId = extractFirstYouTubeVideoId(payload);
                                if (!videoId) {
                                    res.statusCode = 404;
                                    res.setHeader('Content-Type', 'application/json');
                                    res.end(JSON.stringify({ error: 'No video found.' }));
                                    return [2 /*return*/];
                                }
                                result = {
                                    url: "https://www.youtube.com/watch?v=".concat(videoId),
                                    title: extractFirstYouTubeTitle(payload),
                                };
                                searchCache.set(cacheKey, result);
                                res.statusCode = 200;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify(result));
                                return [3 /*break*/, 8];
                            case 7:
                                error_1 = _c.sent();
                                console.error('Vite YouTube search endpoint failed:', error_1);
                                res.statusCode = 500;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify({ error: 'Music search failed.' }));
                                return [3 /*break*/, 8];
                            case 8: return [2 /*return*/];
                        }
                    });
                }); });
            },
        },
    ],
    base: './',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        open: false, // Don't open browser automatically
    },
});
