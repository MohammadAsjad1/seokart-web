# SeoKart Backend – API Documentation

Backend for SEO tools: **website crawler** (sitemap + page analysis), **rank tracker**, **user plans**, and **backlinks**.  
APIs are listed below in simple words with request/response details.

**Jahan ek API multiple kaam karti hai**, wahan **Purpose (Kyun)** aur **Kya karta hai (step-by-step / multiple operations)** alag se explain kiya gaya hai – taaki samajh aaye ki API kyun hai aur andar exactly kya steps chal rahe hain.

---

## Table of Contents

1. [Tech & Run](#tech--run)
2. [Authentication](#authentication)
3. [Auth APIs](#auth-apis)
4. [Scraper APIs](#scraper-apis)
5. [Webpage APIs](#webpage-apis)
6. [Proxy / Scrape URL API](#proxy--scrape-url-api)
7. [User Plan APIs](#user-plan-apis)
8. [Rank Tracker APIs](#rank-tracker-apis)
9. [Backlinks API](#backlinks-api)

---

## Tech & Run

- **Stack:** Node.js, Express, MongoDB, Socket.IO  
- **Run:** From `node-backend` folder: `npm install` then `npm run dev`  
- **Base URL:** `http://localhost:5000` (or your server URL)  
- **Auth:** Most APIs need login. Token is sent via **cookie** (`token`) or **header** `Authorization: Bearer <token>`.

---

## Authentication

- **Login/Signup/Google** → server sets HTTP-only cookie `token` (JWT).  
- **Other APIs** → send same request with cookies (browser) or `Authorization: Bearer <token>` (Postman/app).  
- **Protected** = needs valid token; otherwise 401.

---

## Auth APIs

Base path: **`/api/auth`**

---

### 1. Sign up (Register)

**Endpoint:** `POST /api/auth/signup`  
**Auth:** Not required (public).

**Purpose (Kyun):** Naye user ko system mein register karna – account banane ke baad turant login bhi mil jaye isliye token bhi return/set hota hai.

**Yeh API kya karta hai (step-by-step):**

1. Request body validate karta hai (username length, email format, password length).
2. Same email pehle se hai ya nahi check karta hai – agar hai to "Email already registered" deta hai.
3. Password ko hash karke User document create karta hai (provider: email, hasCompletedSetup: false).
4. User ki lastLogin update karta hai.
5. JWT token generate karta hai aur **cookie** mein set karta hai (taaki browser next requests mein token bheje).
6. Response mein user ki basic info (id, username, email, role, hasCompletedSetup) + message bhejta hai.

**Body (JSON):**

- `username` – Full name (required, min 2 chars)
- `email` – Valid email (required)
- `password` – Min 6 characters (required)

**Success (201):**  
User created, token set in cookie, response has user info (id, username, email, role, hasCompletedSetup, etc.) and message.

**Error (400):** Validation errors (e.g. email format, short password) or "Email already registered".

---

### 2. Login (Email + Password)

**Endpoint:** `POST /api/auth/login`  
**Auth:** Not required (public).

**Purpose (Kyun):** Email/password se login – sirf un users ke liye jo signup pe email provider choose kiye; Google se banaye account ke liye "Please sign in with google" aata hai.

**Yeh API kya karta hai (step-by-step):**

1. Body validate karta hai (email, password required).
2. Email se user dhundhta hai; nahi mila to "Invalid credentials".
3. Agar user **Google** se bana hai (provider !== 'email') to "Please sign in with google" return karta hai.
4. Password compare karta hai (bcrypt); galat to "Invalid credentials".
5. lastLogin update karta hai.
6. JWT generate karke cookie set karta hai.
7. Response mein user object + welcome message bhejta hai.

**Body (JSON):**

- `email` – User email
- `password` – Password

**Success (200):**  
Token set in cookie, response has user object and welcome message.

**Error (400):** "Invalid credentials" or "Please sign in with google" if account is Google-only.

---

### 3. Google Login

**Endpoint:** `POST /api/auth/google`  
**Auth:** Not required (public).

**Purpose (Kyun):** Google se ek-click login – frontend Google Sign-In se jo ID token aata hai usse verify karke user create ya fetch karta hai, taaki password yaad rakhne ki zarurat na ho.

**Yeh API kya karta hai (step-by-step):**

1. Body se `credential` (Google ID token) leta hai; missing to 400.
2. Google library se token verify karta hai (audience = GOOGLE_CLIENT_ID).
3. Token se email aur profile info nikalta hai.
4. Email se user dhundhta hai:
   - **Agar mila:** usi user ko use karta hai.
   - **Agar nahi mila:** naya User create karta hai (username/email/picture from Google, provider: 'google', no password).
5. lastLogin update karta hai.
6. JWT generate karke cookie set karta hai.
7. User object return karta hai.

**Body (JSON):**

- `credential` – Google ID token from frontend Google Sign-In

**Success (200):**  
User created or found, token set in cookie, user object returned.

**Error (400):** "Google credential required" or invalid token.

---

### 4. Logout

**Endpoint:** `POST /api/auth/logout`  
**Auth:** Required (cookie or Bearer token).

**Purpose (Kyun):** User ko safely logout karna – token invalid/cancel nahi hota (JWT stateless hai) lekin browser ka cookie clear ho jata hai taaki next request mein token na bheje aur server 401 de.

**Yeh API kya karta hai:**  
Token verify karke user confirm karta hai → response mein **cookie "token" ko clear** karta hai (same path, maxAge: 0 ya expire set) → frontend ko logged-out consider karna chahiye.

**Body:** Not required.

**Success (200):**  
Cookie cleared, user logged out.

---

### 5. Get Profile

**Endpoint:** `GET /api/auth/profile`  
**Auth:** Required.

**Purpose (Kyun):** Login user ki latest profile dikhana – dashboard/settings mein "current user kaun hai" aur unka plan/domain dikhane ke liye.

**Yeh API kya karta hai:**  
Token se userId nikalta hai → User + UserPlan (agar hai) fetch karta hai → dono ko merge karke response bhejta hai (id, username, email, role, profilePicture, rankTracker plan, webCrawler plan, domains, activeDomain, etc.).

**Success (200):**  
Current user details (id, username, email, role, profilePicture, plans, etc.).

**Error (401):** Invalid or missing token.

---

### 6. Complete Setup

**Endpoint:** `POST /api/auth/complete-setup`  
**Auth:** Required.

**Purpose (Kyun):** Signup/Login ke baad pehli baar user ko plan aur domain choose karwana – iske bina rank tracker / crawler use nahi ho sakta; isliye yeh API ek saath user + plan + domain set karta hai.

**Yeh API multiple kaam karta hai (step-by-step):**

1. **Validate:** plan aur domain required; plan must be free/basic/pro/premium/enterprise; domain format valid hona chahiye (e.g. example.com).
2. **User update:** User document mein `selectedPlan`, `primaryDomain`, `hasCompletedSetup: true` set karta hai.
3. **UserPlan handle:**
   - Agar UserPlan pehle se hai: rankTracker plan + limits update karta hai; domain list mein yeh domain add karta hai (agar nahi hai) ya isko active mark karta hai; `activeDomain` set karta hai.
   - Agar UserPlan nahi hai: naya UserPlan create karta hai – yeh domain, activeDomain, rankTracker (plan + limits + usage), webCrawler (free plan + limits + usage) ke saath.
4. Response mein updated user/plan info bhejta hai.

**Body (JSON):**

- `plan` – e.g. "free", "basic" (required)
- `domain` – User’s main domain (required)

**Success (200):**  
User marked as setup complete, plan/domain saved.

**Error (400):** "Plan and domain are required" or validation error.

---

## Scraper APIs

Base path: **`/api/scraper`**  
**Auth:** All routes require login.

---

### 1. Start website crawl (sitemap crawl)

**Endpoint:** `POST /api/scraper/scrape`  
**Auth:** Required.

**Purpose (Kyun):** Pura website crawl karke har page ka SEO analysis nikalna – sitemap se saari URLs milti hain, phir har URL pe title/meta/content/links/images check hote hain aur score/grade milta hai. Ye sab background mein chalta hai taaki user turant response le sake.

**Yeh API multiple kaam trigger karta hai (flow):**

1. **Validate:** websiteUrl required; agar sitemapUrls nahi di to backend khud sitemap discover karta hai (validateWebsite).
2. **Stalled check:** Agar isi website ke liye pehle se "processing/analyzing" activity hai aur 30s se heartbeat nahi aayi to usko failed mark karke naya crawl allow karta hai; warna "already in progress" return karta hai.
3. **Activity create:** UserActivity document banata hai (userId, websiteUrl, status: processing, progress: 0, sitemapCount, webpageCount, etc.).
4. **Background crawl start:** `webCrawler()` async chalata hai jo:
   - **Phase 1 – Sitemap:** sitemap URLs fetch karke Sitemap collection mein save karta hai.
   - **Phase 2 – Fast scrape:** Har URL ko proxy se fetch karke WebpageCore + basic content save karta hai (title, meta, content, links, images, technical).
   - **Phase 3 – Slow analysis:** Score calculator, grammar/spell checker, duplicate processor, link processor chalata hai – scores, broken links, duplicates, grammar errors save hote hain.
5. Progress Socket se user room ko bhejta hai (activity_status_update).
6. Turant response mein `activityId`, status, progress, message bhejta hai – crawl background mein chalta rahega.

**Body (JSON):**

- `websiteUrl` – Full site URL, e.g. `https://example.com` (required)
- `sitemapUrls` – Optional; if not sent, backend discovers sitemap from site
- `concurrency` – Optional; number of parallel requests (default 15, range 5–25)

**Success (200/201):**  
Returns `activityId`, status, progress, message. Crawl runs in background; use status API or Socket to get progress.

**Error (400):** Invalid URL or "Website validation failed", "No sitemaps found", etc.

---

### 2. Scrape single URL

**Endpoint:** `POST /api/scraper/scrape-url`  
**Auth:** Required.

**Purpose (Kyun):** Ek hi page ko dubara scrape + full SEO analysis karna – jab page pehle se crawl ho chuka hai lekin user us page ko refresh/re-analyze karna chahta ho (grammar, scores, links, duplicates sab dubara nikalte hain).

**Yeh API multiple kaam karta hai (step-by-step):**

1. **Find existing webpage:** userId + websiteUrl + pageUrl se WebpageCore dhundhta hai; nahi mila to 404 "Webpage not found in database" (ye API sirf pehle se crawl hue pages ke liye hai).
2. **Scrape:** WebScraper se page fetch karta hai (proxy rotation use hota hai).
3. **Grammar/Spell check:** content, title, meta description pe grammar/spelling errors nikalta hai.
4. **SEO score calculate:** Score calculator se 20-point score + grade (A–F) nikalta hai.
5. **Links validate:** Link processor se broken/redirect/HTTP links check karta hai.
6. **Duplicates:** Same website ke dusre pages se title/description/content duplicate check karta hai.
7. **Save:** WebpageCore + WebpageContent + WebpageScores + WebpageTechnical + WebpageAnalysis sab update/save karta hai.
8. Response mein updated page data + analysis bhejta hai.

**Body (JSON):**

- `websiteUrl` – Base website URL (required)
- `pageUrl` – Full page URL to scrape (required)

**Success (200):**  
Page data and SEO analysis for that URL.

**Error (400/404):** Missing/invalid URL or "Webpage not found in database" or scrape failure.

---

### 3. Get crawl status

**Endpoint:** `GET /api/scraper/status/:activityId`  
**Auth:** Required.

**Purpose (Kyun):** Ek crawl ka live progress dekhna – sitemap phase chal raha hai ya webpage phase, kitne pages success/fail, kitna time baaki, taaki UI progress bar / status text dikha sake.

**Yeh API kya karta hai (multiple pieces of info):**

1. **Activity fetch:** activityId + userId se UserActivity dhundhta hai; nahi mila to 404.
2. **Real-time metrics calculate karta hai:**
   - `elapsedTime` – start se ab tak kitna time
   - `estimatedTimeRemaining` – activity ke hisaab se kitna time aur (approx)
   - `processingSpeed` – kitne pages per unit time
   - `successRate` – successful vs total
3. **Phase info:** sitemap phase chal raha hai ya webpage phase, fast scraping complete hua ya nahi, slow analysis complete hua ya nahi.
4. **Counts return karta hai:** sitemapCount, webpageCount, webpagesSuccessful, webpagesFailed, errorMessages, startTime, endTime, lastUpdated.
5. **Metadata:** concurrency, crawlCount, websiteUrl.

**Params:**

- `activityId` – MongoDB ObjectId of the crawl activity

**Success (200):**  
Object with status, progress %, phaseInfo, isSitemapCrawling, isWebpageCrawling, webpageCount, webpagesSuccessful, webpagesFailed, elapsedTime, estimatedTimeRemaining, processingSpeed, successRate, errorMessages, metadata, etc.

**Error (404):** Activity not found or not owned by user.

---

### 4. Get user’s crawl activities

**Endpoint:** `GET /api/scraper/get-activities`  
**Auth:** Required.

**Purpose (Kyun):** User ki saari crawl activities list karna – dashboard pe "previous crawls" ya "current crawl" dikhane ke liye, filter/sort ke saath.

**Yeh API kya karta hai (multiple kaam):**

1. **Filter:** userId se filter; optional: `status`, `websiteUrl` (regex match).
2. **Pagination:** `page`, `limit` validate karke skip/limit lagata hai.
3. **Sort:** `sortBy` (default lastCrawlStarted), `sortOrder` (asc/desc) se activities fetch karta hai.
4. **Har activity ko enhance karta hai:** estimatedTimeRemaining, processingSpeed, successRate, isActive (processing/analyzing hai ya nahi), phaseDescription, detailedPhase add karta hai taaki UI ko extra calculation na karni pade.
5. **Response:** data array + totalCount + pagination (page, limit, totalPages, hasNext, hasPrev) + filters + timestamp.

**Query (optional):**

- `page`, `limit` – Pagination
- `status` – Filter by status (e.g. processing, completed, failed)
- `websiteUrl` – Filter by site
- `sortBy`, `sortOrder` – Sort field and order

**Success (200):**  
List of activities (activityId, websiteUrl, status, progress, startTime, estimatedTimeRemaining, processingSpeed, successRate, isActive, phaseDescription, etc.) + pagination + filters.

---

### 5. Stop crawl

**Endpoint:** `POST /api/scraper/stop`  
**Purpose:** Request to stop an ongoing crawl.

**Body (JSON):**

- `activityId` – ID of the activity to stop

**Success (200):**  
Message that stop was requested. Crawl may take a short time to actually stop.

**Error (400/404):** Missing activityId or activity not found.

---

## Webpage APIs

Base path: **`/api/webpage`**  
**Auth:** All routes require login.  
**Purpose:** Read/delete data of already crawled pages (by activity).

---

### 1. Get paginated webpages for an activity

**Endpoint:** `GET /api/webpage/:activityId`  
**Auth:** Required.

**Purpose (Kyun):** Ek crawl activity ke andar jo pages crawl hue hain unki list dikhana – table/grid mein pagination, filter, sort ke saath; include se control hota hai ki content/scores/technical/analysis bhi aaye ya sirf basic fields.

**Yeh API multiple kaam karta hai:**

1. **Ownership check:** activityId + userId se UserActivity dhundhta hai; nahi mila to 404.
2. **Filter build:** query params se – `filter` (JSON) mein statusCode, seoGrade, hasErrors, search, url, websiteUrl, pageUrl, seoScoreRange, isProcessed; alag se `search` bhi URL/title/websiteUrl pe search karta hai.
3. **Projection:** `include` ke hisaab se sirf basic fields ya contentId/technicalId/analysisId/scoresId bhi select karta hai.
4. **Sort:** sort (lastCrawled / seoScore / statusCode) + order (asc/desc) lagata hai.
5. **Paginate:** skip/limit se WebpageCore list + total count leta hai.
6. **Populate (agar include !== "basic"):** WebpageContent, WebpageTechnical, WebpageAnalysis, WebpageScores alag collections se fetch karke har webpage ke saath merge karta hai (content, technical, analysis, scores objects).
7. **Error summary:** usi filter ke andar error type ke hisaab se count (e.g. 404 kitne, 500 kitne) nikalta hai.
8. **Response:** webpages array + pagination (total, page, limit) + errorCounts.

**Params:**

- `activityId` – Crawl activity ID

**Query (optional):**

- `page` – Page number (default 1)
- `limit` – Items per page (default 10)
- `sort` – Field to sort by (e.g. `lastCrawled`, `seoScore`, `statusCode`)
- `order` – `asc` or `desc`
- `filter` – JSON string for filters (statusCode, seoGrade, hasErrors, search, url, seoScoreRange, isProcessed, etc.)
- `search` – Text search in URL/title/websiteUrl
- `include` – `"basic"` (sirf core fields), `"content"` / `"technical"` / `"analysis"` / `"scores"` ya `"all"` (sab linked data)

**Success (200):**  
Paginated list of webpages (url, title, metaDescription, seoScore, seoGrade, statusCode, + optional content/technical/analysis/scores) + pagination + errorCounts.

**Error (404):** Activity not found or not owned by user.

---

### 2. Get one webpage by ID

**Endpoint:** `GET /api/webpage/detail/:id`  
**Auth:** Required.

**Purpose (Kyun):** Ek page ka **pura** detail dikhana – sirf core nahi, balki content (title, meta, headings, wordCount), scores (20-point SEO score, grade), technical (canonical, links, broken links, mobile), analysis (images, duplicates, grammar) sab ek saath; detail page / modal ke liye.

**Yeh API kya karta hai:**

1. **Fetch core:** id + userId se WebpageCore dhundhta hai; nahi mila to 404.
2. **Populate refs:** contentId, scoresId, technicalId, analysisId se WebpageContent, WebpageScores, WebpageTechnical, WebpageAnalysis alag collections se fetch karta hai.
3. **Merge:** Ek object mein core + content + scores + technical + analysis merge karke return karta hai.
4. **Response:** Full webpage document (url, title, meta, content, wordCount, headingStructure, seoScore, seoGrade, scores breakdown, links/broken links, images/alt, duplicates, grammar errors, etc.).

**Params:**

- `id` – Webpage core document ID (MongoDB ObjectId)

**Success (200):**  
Full webpage document including linked content, scores, technical, analysis.

**Error (404):** Webpage not found or not owned by user.

---

### 3. Get webpage stats for a website

**Endpoint:** `GET /api/webpage/:websiteUrl/stats`  
**Auth:** Required.

**Purpose (Kyun):** Ek website ke saare crawled pages ka **summary** dikhana – total kitne pages, average SEO score, grade-wise count (A/B/C/D/F), success/fail count; dashboard / overview ke liye.

**Yeh API kya karta hai:**

1. **Normalize:** :websiteUrl param se website URL nikalta hai (URL-encoded ho sakta hai).
2. **Filter:** userId + websiteUrl (match) se WebpageCore documents count/aggregate karta hai.
3. **Aggregate:** total count, avg seoScore, statusCode-wise count (200/404/500), seoGrade-wise count (A, B, C, D, F), hasErrors count, etc. nikalta hai.
4. **Response:** Ek stats object return karta hai (totalPages, avgScore, gradeCounts, successCount, failedCount, etc.).

**Note:** `:websiteUrl` is usually URL-encoded (e.g. `https%3A%2F%2Fexample.com`).

**Success (200):**  
Stats object (total pages, success/fail counts, average SEO score, grade counts, etc.).

**Error (404):** No data for that website or user.

---

### 4. Get error webpages by type

**Endpoint:** `GET /api/webpage/:activityId/errors/:errorType`  
**Auth:** Required.

**Purpose (Kyun):** Crawl ke andar jo pages **error** pe aaye (404, 500, timeout) unki list dikhana – taaki user sirf problematic pages dekh sake aur fix kare.

**Yeh API kya karta hai:**

1. **Ownership check:** activityId + userId se UserActivity dhundhta hai; nahi mila to 404.
2. **Filter:** userActivityId + activityId + error condition (errorType ke hisaab se – e.g. statusCode === 404, ya hasErrors === true, ya errorMessage match) se WebpageCore query karta hai.
3. **Paginate:** page, limit agar support ho to skip/limit lagata hai.
4. **Return:** Un webpages ki list (url, statusCode, errorMessage, lastCrawled, etc.) return karta hai.

**Params:**

- `activityId` – Crawl activity ID  
- `errorType` – Type of error (e.g. `404`, `500`, `timeout` – exact values depend on backend)

**Query (optional):** Pagination (page, limit) if supported.

**Success (200):**  
List of webpages matching that error type.

**Error (404):** Activity not found or not owned by user.

---

### 5. Delete website activity (and its data)

**Endpoint:** `DELETE /api/webpage/activity/:activityId`  
**Auth:** Required.

**Purpose (Kyun):** User purani crawl activity hata dena chahta hai – taaki list clean rahe aur storage bache; ek saath activity + usse linked saari webpages + sitemap URLs delete ho jate hain.

**Yeh API multiple kaam karta hai:**

1. **Ownership check:** activityId + userId se UserActivity dhundhta hai; nahi mila to 404.
2. **Related data delete:**  
   - Us activityId se saare **WebpageCore** (aur unke contentId, scoresId, technicalId, analysisId → WebpageContent, WebpageScores, WebpageTechnical, WebpageAnalysis) delete karta hai.  
   - Us activityId se **Sitemap** collection ke entries delete karta hai.  
   - **UserActivity** document khud delete karta hai.
3. **Response:** Success message return karta hai.

**Params:**

- `activityId` – Crawl activity ID

**Success (200):**  
Message that activity and related data were deleted.

**Error (404):** Activity not found or not owned by user.

---

## Proxy / Scrape URL API

**Endpoint:** `POST /api/proxy_rotate`  
**Auth:** Not required (public).

**Purpose (Kyun):** Ek URL ko **rotate hone wale proxy IPs** se fetch karna – jab aap main crawl flow ke bahar se kisi bhi URL ka HTML/SEO data lena chahte ho (e.g. external tool, one-off check). Proxy rotation isliye taaki ek hi IP pe zyada load na pade aur block na ho.

**Yeh API kya karta hai:**

1. **Validate:** body mein `url` required; URL format valid hona chahiye (new URL(url)).
2. **Scrape:** Core WebScraper use karta hai – andar proxy rotation hoti hai (100 requests per proxy, block hone pe next proxy). Request proxy se jati hai, HTML aata hai.
3. **Parse:** Cheerio se HTML parse karke title, meta description, content, headings, images, links, technical (canonical, viewport, etc.) nikalta hai.
4. **Response:** scrapedData (url, title, metaDescription, content, wordCount, headingStructure, images, links, technicalSeo, statusCode, response_time, scraping_method, proxy_used) bhejta hai.
5. **Errors:** 404/503/500 ke hisaab se appropriate message + shouldRetry (403/429 pe retry suggest karta hai).

**Body (JSON):**

- `url` – Full URL to fetch (required)

**Success (200):**  
`{ success: true, data: scrapedData }` – scrapedData has title, metaDescription, content, links, images, statusCode, etc.

**Error (400):** "URL is required" or "Invalid URL format".  
**Error (404):** Page not found.  
**Error (500/503):** Scrape failed or service unavailable.

---

## User Plan APIs

Base path: **`/api/user-plan`**  
**Auth:** Most routes require login (except plan info).  
**Purpose:** Manage user’s subscription plan, domains, and usage limits.

---

### 1. Get plan info (pricing / limits)

**Endpoint:** `GET /api/user-plan/info`  
**Auth:** Not required (public).

**Purpose:** Get available plans and their limits/pricing (e.g. free, basic, premium for rankTracker and webCrawler).

**Success (200):**  
Plan info (names, limits, pricing if any).

---

### 2. Create user plan (after signup)

**Endpoint:** `POST /api/user-plan`  
**Auth:** Required.

**Purpose (Kyun):** Signup/first login ke baad user ke liye plan record banana – taaki rank tracker / web crawler use karne se pehle limits aur usage track ho sake; ek baar banta hai, phir update/domains alag APIs se.

**Yeh API kya karta hai:**

1. **Validate:** userId token se; valid ObjectId hona chahiye.
2. **Duplicate check:** Agar is userId ka UserPlan pehle se hai to "User plan already exists" return karta hai.
3. **Create:** Naya UserPlan document banata hai – userId, domains (empty ya default), rankTracker (plan: free, limits, usage: 0), webCrawler (plan: free, limits, usage: 0), subscription/billing fields (agar model mein hon).
4. **Save** karke created plan return karta hai.

**Body:** Usually none or minimal; user ID from token.

**Success (200/201):**  
Created plan document.

**Error (400):** e.g. "User ID is required" or "User plan already exists".

---

### 3. Get current user plan

**Endpoint:** `GET /api/user-plan`  
**Auth:** Required.

**Purpose:** Get logged-in user’s plan (rankTracker plan, webCrawler plan, domains, usage, limits).

**Success (200):**  
User plan object (plans, domains, usage, limits).

---

### 4. Update user plan (upgrade/downgrade)

**Endpoint:** `PUT /api/user-plan`  
**Auth:** Required.  
**Rate limit:** 5 requests per 15 minutes.

**Purpose (Kyun):** User apna plan badal sake – rank tracker ya web crawler ke liye free/basic/premium/enterprise choose karne ke liye; limits bhi usi plan ke hisaab se update ho jate hain.

**Yeh API kya karta hai:**

1. **Validate:** service (rankTracker / webCrawler), plan (valid list se); billingInfo agar di ho to amount/status/dates validate.
2. **UserPlan dhundhta hai** userId se; nahi mila to error.
3. **Update:** service ke hisaab se us service ka plan + limits update karta hai (e.g. rankTracker.plan, rankTracker.limits); agar billingInfo di hai to subscription/billing fields bhi update.
4. **Save** karke updated plan return karta hai.

**Body (JSON):**

- `service` – `"rankTracker"` or `"webCrawler"`
- `plan` – e.g. `"free"`, `"basic"`, `"premium"`, `"enterprise"` (for rankTracker)
- `billingInfo` – Optional (amount, status, endDate, nextBillingDate)

**Success (200):**  
Updated plan.

**Error (400):** Invalid service/plan or validation error.

---

### 5. Get user domains

**Endpoint:** `GET /api/user-plan/domains`  
**Auth:** Required.

**Purpose:** List all domains added to the user’s plan.

**Success (200):**  
Array of domains (domain, isActive, addedAt, etc.).

---

### 6. Add domain

**Endpoint:** `POST /api/user-plan/domains`  
**Auth:** Required.  
**Rate limit:** 20 domain operations per 5 minutes.

**Purpose (Kyun):** User apni plan mein naya domain add karna chahta hai – rank tracker/crawler ke liye multiple sites track karne ke liye; setAsActive se turant is domain ko active bhi kar sakta hai.

**Yeh API kya karta hai:**

1. **Validate:** domain required, string; setAsActive agar di ho to boolean.
2. **UserPlan fetch:** userId se UserPlan dhundhta hai.
3. **Domain add:** domains array mein check karta hai – agar ye domain pehle se nahi hai to naya entry push karta hai (domain, isActive: setAsActive ya false, addedAt).
4. **Active handle:** Agar setAsActive true hai to pehle saare domains ko isActive: false karta hai, phir is naye (ya existing) domain ko isActive: true + activeDomain field set karta hai; agar domain pehle se tha to sirf isko active mark karta hai.
5. **Save** karke updated plan return karta hai.

**Body (JSON):**

- `domain` – Domain string (required)
- `setAsActive` – Optional boolean; set this domain as active

**Success (200/201):**  
Updated domains list or new domain added.

**Error (400):** "Domain is required" or invalid format.

---

### 7. Set active domain

**Endpoint:** `PUT /api/user-plan/domains/active`  
**Auth:** Required.

**Body (JSON):**

- `domain` – Domain to set as active (required)

**Success (200):**  
Active domain updated.

---

### 8. Remove domain

**Endpoint:** `DELETE /api/user-plan/domains/:domain`  
**Auth:** Required.

**Params:** `domain` – Domain to remove (e.g. `example.com`).

**Success (200):**  
Domain removed from user plan.

**Error (400/404):** Invalid or unknown domain.

---

### 9. Update usage (internal)

**Endpoint:** `POST /api/user-plan/usage`  
**Auth:** Required.  
**Rate limit:** 100 per minute.

**Body (JSON):**

- `service` – `"rankTracker"` or `"webCrawler"`
- `resource` – e.g. `"keywords"`, `"pages"`, `"crawls"`
- `amount` – Number (optional)
- `operation` – `"increment"` or `"decrement"` (optional)

**Purpose:** Backend or internal jobs use this to update usage counters. Frontend usually doesn’t call this directly.

---

### 10. Check limits

**Endpoint:** `GET /api/user-plan/limits`  
**Auth:** Required.

**Purpose (Kyun):** Pata chal sake ki user ab kya kya kar sakta hai – plan ke hisaab se keywords/crawls/domains ki limit aur ab tak kitna use ho chuka hai; frontend isse use karke "Add keyword" / "Start crawl" enable/disable ya limit message dikhata hai.

**Yeh API kya karta hai:**

1. Token se userId nikalta hai; UserPlan fetch karta hai.
2. Rank tracker aur web crawler dono ke liye **limits** (max keywords, max competitors, max domains, pages per month, etc.) + **current usage** (keywordsUsed, competitorsUsed, pagesThisMonth, etc.) nikalta hai.
3. Agar koi action check ho (e.g. canAddKeyword) to usage < limit compare karke boolean bhi de sakta hai (implementation pe depend).
4. Response mein limits + usage return karta hai.

**Query (optional):** e.g. `service`, `action` (implementation-specific).

**Success (200):**  
Limits and current usage (e.g. keywordsLimit, keywordsUsed, pagesPerMonth, pagesThisMonth, etc.).

---

### 11. Admin: Reset monthly usage

**Endpoint:** `POST /api/user-plan/admin/reset-usage`  
**Auth:** Required (admin).

**Purpose:** Reset usage counters for all users (e.g. monthly cron job).

**Success (200):**  
Confirmation of reset.

---

### 12. Admin: Plan stats

**Endpoint:** `GET /api/user-plan/admin/stats`  
**Auth:** Required (admin).

**Purpose:** Dashboard stats – plan distribution, subscription status, domain usage.

**Success (200):**  
Aggregated stats (planDistribution, subscriptionStatus, domainUsage, etc.).

---

### 13. Admin: Domain stats

**Endpoint:** `GET /api/user-plan/admin/domain-stats`  
**Auth:** Required (admin).

**Purpose:** Popular domains, recent domain additions (e.g. last 30 days).

**Success (200):**  
popularDomains, recentDomainAdditions.

---

## Rank Tracker APIs

Base path: **`/api/rank-tracker`**  
**Auth:** Most routes require login (except callbacks from DataForSEO).  
**Purpose:** Track keyword rankings and competitors; suggestions and refresh.

---

### 1. Google suggestions

**Endpoint:** `GET /api/rank-tracker/google-suggestions`  
**Auth:** Required.  
**Rate limit:** 10 per minute.

**Purpose (Kyun):** User keyword add karte waqt **suggestions** chahta hai – Google autocomplete jaisa; taaki popular/long-tail keywords easily choose kar sake.

**Yeh API kya karta hai:**

1. **Validate:** query param required; length max 100; harmful chars hata ke sanitize.
2. **External call:** Google Suggest API (suggestqueries.google.com) ko request bhejta hai – client: firefox, q: sanitized query.
3. **Parse:** Response JSONP/array format hota hai; suggestions array (data[1]) nikalta hai.
4. **Filter/Limit:** Empty hata ke top 10 suggestions return karta hai.
5. **Response:** query, suggestions array, count, generatedAt.

**Query:**

- `query` – Search string (required, max 100 chars)

**Success (200):**  
`{ success: true, data: { query, suggestions: [...], count } }`.

**Error (400):** Missing or too long query. **Error (503):** Google service unavailable.

---

### 2. Add keyword

**Endpoint:** `POST /api/rank-tracker/add-keyword`  
**Auth:** Required.

**Purpose (Kyun):** User apni website ke liye keyword add karke unka Google ranking track karna chahta hai – is keyword ke liye DataForSEO (ya similar) se SERP data mangwaya jata hai aur position save hoti hai.

**Yeh API multiple kaam karta hai:**

1. **Validate:** keyword aur targetDomain required; domain format valid (e.g. example.com).
2. **Plan limit check:** User ke plan ke hisaab se keywords ki limit check hoti hai; limit full to error.
3. **Keyword create:** Keyword document banata hai (userId, keyword, targetDomain, isActive, currentRanking: position/trend, etc.).
4. **Ranking fetch:** DataForSEO (ya internal service) ko task bhejta hai – SERP mein is keyword ke liye target domain ki position nikalne ke liye; result callback se aata hai.
5. **Response:** Added keyword + initial ranking (agar turant mila) return karta hai.

**Body (JSON):**

- `keyword` – Keyword to track (required)
- `targetDomain` – Domain to track for (required, e.g. `example.com`)

**Success (200/201):**  
Keyword added and initial ranking data (if any).

**Error (400):** "Keyword is required" or "Target domain is required" or plan limit exceeded.

---

### 3. Bulk add keywords

**Endpoint:** `POST /api/rank-tracker/bulk-add-keywords`  
**Auth:** Required.

**Body (JSON):**

- `keywords` – Array of `{ keyword, targetDomain }` (max 20 items)

**Success (200):**  
`{ successful, failed, results, errors }`.

---

### 4. Remove keyword

**Endpoint:** `DELETE /api/rank-tracker/remove-keyword/:keywordId`  
**Auth:** Required.

**Params:** `keywordId` – MongoDB ObjectId of the keyword.

**Success (200):**  
Keyword removed.

**Error (400):** Invalid keywordId.

---

### 5. Bulk remove keywords

**Endpoint:** `DELETE /api/rank-tracker/bulk-remove-keywords`  
**Auth:** Required.

**Body (JSON):** Array of keyword IDs or similar (implementation-specific).

**Success (200):**  
Bulk removal result.

---

### 6. Get keywords

**Endpoint:** `GET /api/rank-tracker/keywords`  
**Auth:** Required.

**Purpose:** List all keywords added by the user (with target domain and ranking info).

**Query (optional):** `targetDomain` to filter.

**Success (200):**  
List of keywords (id, keyword, targetDomain, currentRanking, etc.).

---

### 7. Keyword suggestions

**Endpoint:** `GET /api/rank-tracker/keyword-suggestions`  
**Auth:** Required.

**Query:**

- `targetDomain` – Required

**Purpose:** Get suggested keywords based on domain and existing keywords.

**Success (200):**  
List of suggested keywords.

**Error (400):** "Target domain is required".

---

### 8. Add competitor

**Endpoint:** `POST /api/rank-tracker/add-competitor`  
**Auth:** Required.

**Body (JSON):**

- `competitors` – Array of competitor domains or names (required)

**Success (200/201):**  
Competitors added.

**Error (400):** "Competitors are required".

---

### 9. Remove competitor

**Endpoint:** `DELETE /api/rank-tracker/remove-competitor/:competitorId`  
**Auth:** Required.

**Params:** `competitorId` – MongoDB ObjectId.

**Success (200):**  
Competitor removed.

---

### 10. Get competitors

**Endpoint:** `GET /api/rank-tracker/competitors`  
**Auth:** Required.

**Purpose:** List all competitors (names/domains, no full ranking data).

**Success (200):**  
List of competitors.

---

### 11. Competitor suggestions

**Endpoint:** `GET /api/rank-tracker/competitor-suggestions`  
**Auth:** Required.

**Query:**

- `targetDomain` – Required

**Purpose:** Get suggested competitor domains based on target domain and keywords.

**Success (200):**  
List of competitor suggestions.

---

### 12. Dashboard rankings

**Endpoint:** `GET /api/rank-tracker/dashboard-rankings`  
**Auth:** Required.

**Purpose (Kyun):** Dashboard pe ek hi jagah dikhana ki target domain + competitors sabhi keywords pe kahan rank kar rahe hain – taaki user apna vs competitor performance ek saath dekh sake.

**Yeh API kya karta hai:**

1. **Validate:** targetDomain query mein required.
2. **Keywords fetch:** User ke active keywords (target domain se match) + unke current ranking (position, trend) leta hai.
3. **Competitors fetch:** User ke added competitors + un keywords pe unki positions leta hai.
4. **Merge:** Har keyword ke liye target domain ki position + har competitor ki position – dashboard table/chart ke liye structure karta hai.
5. **Response:** Rankings data (keywords list, target positions, competitor positions, trends) return karta hai.

**Query:**

- `targetDomain` – Required

**Success (200):**  
Rankings data for dashboard (target + competitors per keyword).

**Error (400):** "Target domain is required".

---

### 13. Refresh rankings

**Endpoint:** `POST /api/rank-tracker/refresh`  
**Auth:** Required.  
**Rate limit:** 3 per 5 minutes.

**Purpose (Kyun):** Rankings latest laane ke liye – DataForSEO se naya SERP data mangwana; keywordIds diye to sirf un keywords ke liye, nahi to user ke saare active keywords ke liye refresh hota hai.

**Yeh API kya karta hai:**

1. **Validate:** keywordIds agar diye to array of valid ObjectIds; max 50 ek saath; omit = refresh all.
2. **Keywords resolve:** keywordIds se ya userId se saare active keywords nikalta hai.
3. **Tasks create:** Har keyword ke liye DataForSEO (ya internal) ko SERP task bhejta hai – callback URL ke through result aata hai.
4. **Callback pe:** SERP result aane pe keyword document mein currentRanking (position, trend, lastUpdated) update hota hai.
5. **Response:** Refresh triggered message return karta hai; actual data callback ke baad aata hai.

**Body (JSON):**

- `keywordIds` – Optional array of keyword IDs; if omitted, refresh all

**Success (200):**  
Refresh triggered.

**Error (400):** Invalid keywordIds or more than 50 at once.

---

### 14. Keyword ranking history / analysis

**Endpoint:** `POST /api/rank-tracker/history`  
**Auth:** Required.

**Body (JSON):** Keyword IDs or filters (implementation-specific).

**Purpose:** Get historical ranking data for analysis.

**Success (200):**  
History/analysis data.

---

### 15. Keyword insights

**Endpoint:** `GET /api/rank-tracker/:userId/keyword-insights`  
**Auth:** Required.

**Params:** `userId` – Must match logged-in user.

**Purpose:** Keyword performance insights (trends, counts).

**Success (200):**  
totalKeywords, trends, etc.

---

### 16. Competitor insights

**Endpoint:** `GET /api/rank-tracker/:userId/competitor-insights`  
**Auth:** Required.

**Params:** `userId` – Must match logged-in user.

**Purpose:** Competitor performance summary.

**Success (200):**  
totalCompetitors, competitors list with stats.

---

### 17. DataForSEO callbacks (public)

**Endpoints:**

- `POST /api/rank-tracker/callback` – SERP results callback
- `POST /api/rank-tracker/ai-mode-callback` – AI mode callback
- `GET /api/rank-tracker/pingback` – Legacy pingback
- `GET /api/rank-tracker/ai-mode-pingback` – Legacy AI pingback

**Auth:** Not required (called by DataForSEO servers).

**Purpose (Kyun):** Refresh / add keyword ke baad DataForSEO SERP result **callback** se bhejta hai – is API pe result aata hai taaki backend keyword ki position save/update kar sake; frontend ko polling ki zarurat nahi.

**Yeh API kya karta hai:**

1. **Receive:** DataForSEO request body mein task_id, result (SERP data – rankings, URLs, positions) bhejta hai.
2. **Match:** task_id se pehle bheja hua keyword/target domain identify karta hai (internal mapping/cache se).
3. **Parse:** SERP result se target domain ki position (aur competitors ki agar di ho) nikalta hai.
4. **Update:** Keyword document mein currentRanking (position, trend, lastUpdated), SERP snapshot (optional) save karta hai.
5. **Response:** 200 OK bhejta hai taaki DataForSEO retry na kare.

---

### 18. SEO settings (internal)

**Endpoint:** `GET /api/rank-tracker/seo-settings`  
**Auth:** Not required in code (check if restricted in production).

**Purpose:** Get stored SEO/Keyword params (e.g. country, language).

**Success (200):**  
SEO settings document.

---

## Backlinks API

Base path: **`/api/backlinks`**  
**Auth:** Required.

---

### Get backlink dashboard data

**Endpoint:** `GET /api/backlinks/dashboard`  
**Auth:** Required.

**Purpose (Kyun):** User apni website ke backlinks (kaun kaun si sites link de rahi hain) dashboard pe dekhna chahta hai – summary (total count, domain score) + list with filter/sort/pagination taaki useful backlinks nikal sake.

**Yeh API multiple kaam karta hai:**

1. **Validate:** websiteUrl required; dates (firstSeen, lastSeen from/to) agar diye to valid format; minDomainScore/maxDomainScore 0–100 range.
2. **Summary fetch (external API):** Backlink service (e.g. SEOPowerSuite) ke summary endpoint ko call karta hai – target = websiteUrl; response mein total backlinks count, domain stats milte hain.
3. **Backlinks list fetch:** Backlinks endpoint se detailed list (url_from, url_to, title, anchor, nofollow, image, domain_inlink_rank, first_seen, last_visited, etc.) leta hai.
4. **Cache/DB:** BacklinkSummary model mein summary + backlinks save/update ho sakte hain (implementation pe depend) taaki baar‑bar external API na chalani pade.
5. **Filter:** query param se url_from, url_to, title, anchor pe search (regex); firstSeen/lastSeen date range; minDomainScore/maxDomainScore; linkTypes, anchorText agar support ho.
6. **Sort:** sortBy ke hisaab se list sort karta hai.
7. **Paginate:** page, limit se slice karke list return karta hai.
8. **Response:** summary (total backlinks, domain score, etc.) + paginated backlinks list (url_from, url_to, title, anchor, domain_inlink_rank, first_seen, last_visited, nofollow, image, etc.).

**Query:**

- `websiteUrl` – Required (website to get backlinks for)
- `page`, `limit` – Pagination
- `query` – Search in url_from, url_to, title, anchor
- `firstSeenFromDate`, `firstSeenToDate`, `lastSeenFromDate`, `lastSeenToDate` – Date filters
- `sortBy` – Sort field
- `minDomainScore`, `maxDomainScore` – Domain score range
- `linkTypes`, `anchorText` – Optional filters

**Success (200):**  
Paginated backlinks list and/or summary (e.g. total count, list of backlinks with url_from, url_to, title, anchor, domain score).

**Error (400):** "websiteUrl is required" or invalid date/format. **Error (401):** Not logged in.

---

## Socket.IO (real-time)

**URL:** Same host as API (e.g. `http://localhost:5000`).  
**Auth:** Socket connection uses same JWT (cookie or handshake auth).

**Events (client → server):**

- `get_user_activities` – Request list of user’s crawl activities
- `get_activity_status` – Request status of one activity (payload: `{ activityId }`)
- `join-activity-room` – Join room for activity updates (payload: `activityId`)
- `leave-activity-room` – Leave activity room
- `authenticate` – Confirm auth (optional)

**Events (server → client):**

- `user_activities_update` – List of activities
- `activity_status_update` – Progress, status, counts for one crawl
- `authenticated` / `authentication_error` – Auth result

After login, connect to Socket.IO with the same token; you’ll receive live crawl progress (e.g. sitemap count, webpage success/fail) without polling the status API.

---

## Summary table

| Module      | Base path           | Main use |
|------------|---------------------|----------|
| Auth       | `/api/auth`         | Signup, login, Google, profile, logout, complete-setup |
| Scraper    | `/api/scraper`      | Start/stop crawl, single URL scrape, status, activities |
| Webpage    | `/api/webpage`      | List/detail webpages, stats, errors, delete activity |
| Proxy      | `/api/proxy_rotate` | Scrape one URL with rotating proxy (no auth) |
| User plan  | `/api/user-plan`    | Plan info, create/update plan, domains, usage, limits, admin |
| Rank tracker | `/api/rank-tracker` | Keywords, competitors, suggestions, refresh, dashboard, callbacks |
| Backlinks  | `/api/backlinks`   | Dashboard backlink data for a website |

---

*For environment variables (MongoDB, JWT, Google OAuth, DataForSEO, etc.), check `node-backend/.env.example` or project docs.*
