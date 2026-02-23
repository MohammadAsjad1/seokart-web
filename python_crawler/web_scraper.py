import sys
import platform
import asyncio
import json
import time
import re
import traceback
import argparse
from urllib.parse import urlparse, urljoin
from datetime import datetime
import warnings
import logging
import random
import os
import subprocess
import signal
import hashlib

# Fix Windows event loop issues
if platform.system() == 'Windows':
    if sys.version_info >= (3, 8):
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except AttributeError:
            pass

# Suppress all warnings and logs
warnings.filterwarnings("ignore")
os.environ['PYTHONWARNINGS'] = 'ignore'

# Configure minimal logging
logging.basicConfig(level=logging.CRITICAL, format="%(message)s", stream=sys.stderr)
logger = logging.getLogger("adaptive_seo_scraper")

class AdaptiveScraper:
    def __init__(self):
        self.user_agents = [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        ]
        self.session_cache = {}
        
    def get_website_url(self, page_url):
        try:
            parsed = urlparse(page_url)
            return f"{parsed.scheme}://{parsed.netloc}"
        except:
            return ""

    def analyze_response_for_protection(self, response_text, status_code, url):
        """Analyze response to detect anti-bot protection"""
        indicators = {
            'cloudflare': False,
            'captcha': False,
            'rate_limit': False,
            'access_denied': False,
            'empty_response': False,
            'suspicious_redirect': False
        }
        
        if not response_text or len(response_text.strip()) == 0:
            indicators['empty_response'] = True
            return indicators, 80  # High protection score for empty responses
        
        content_lower = response_text.lower()
        
        # Check for common anti-bot patterns
        if 'cloudflare' in content_lower or 'ray id' in content_lower:
            indicators['cloudflare'] = True
        
        if 'captcha' in content_lower or 'recaptcha' in content_lower:
            indicators['captcha'] = True
        
        if 'rate limit' in content_lower or 'too many requests' in content_lower:
            indicators['rate_limit'] = True
        
        if status_code in [403, 429, 503]:
            indicators['access_denied'] = True
        
        # Check for challenge pages
        if len(response_text) < 1000 and any(word in content_lower for word in [
            'challenge', 'verify', 'security check', 'please wait', 'checking your browser'
        ]):
            indicators['suspicious_redirect'] = True
        
        # Calculate protection score
        protection_score = sum([
            indicators['cloudflare'] * 30,
            indicators['captcha'] * 40,
            indicators['rate_limit'] * 35,
            indicators['access_denied'] * 25,
            indicators['empty_response'] * 20,
            indicators['suspicious_redirect'] * 30
        ])
        
        return indicators, min(100, protection_score)

    async def scrape_with_requests_smart(self, url, timeout=10):
        """Smart requests scraping with session reuse and better headers"""
        try:
            import requests
            from requests.adapters import HTTPAdapter
            from urllib3.util.retry import Retry
            import urllib3
            
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            # Create or reuse session
            domain = urlparse(url).netloc
            if domain not in self.session_cache:
                session = requests.Session()
                
                retry_strategy = Retry(
                    total=1,
                    backoff_factor=0.2,
                    status_forcelist=[429, 500, 502, 503, 504],
                    raise_on_status=False
                )
                
                
                adapter = HTTPAdapter(max_retries=retry_strategy, pool_maxsize=10)
                session.mount("http://", adapter)
                session.mount("https://", adapter)
                
                self.session_cache[domain] = session
            else:
                session = self.session_cache[domain]
            
            # Enhanced headers to look more like a real browser
            headers = {
                'User-Agent': random.choice(self.user_agents),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Charset': 'utf-8, iso-8859-1;q=0.5',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
                'DNT': '1',
                'Sec-CH-UA': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-CH-UA-Mobile': '?0',
                'Sec-CH-UA-Platform': '"Windows"'
            }
            
            # Add random delay to avoid rate limiting
            await asyncio.sleep(random.uniform(0.1, 0.8))
            
            start_time = time.time()
            
            response = session.get(
                url, 
                headers=headers, 
                timeout=timeout, 
                allow_redirects=True,
                verify=False,
                stream=False
            )
            
            load_time = (time.time() - start_time) * 1000
            
            # Analyze response for protection
            indicators, protection_score = self.analyze_response_for_protection(
                response.text, response.status_code, url
            )
            
            # If protection detected, still return the response for analysis
            result = {
                'html': response.text,
                'title': '',
                'url': response.url,
                'status_code': response.status_code,
                'performance': {'loadComplete': load_time},
                'method': 'requests_smart',
                'protection_detected': protection_score > 20,
                'protection_score': protection_score,
                'protection_indicators': indicators
            }
            
            return result
            
        except Exception as e:
            raise Exception(f"Smart requests scraping failed: {str(e)}")

    async def scrape_with_requests_basic(self, url, timeout=8):
        """Basic fast requests scraping"""
        try:
            import requests
            import urllib3
            
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            
            headers = {
                'User-Agent': random.choice(self.user_agents),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Connection': 'keep-alive',
            }
            
            start_time = time.time()
            
            response = requests.get(
                url, 
                headers=headers, 
                timeout=timeout, 
                allow_redirects=True,
                verify=False
            )
            
            load_time = (time.time() - start_time) * 1000
            
            # Quick protection analysis
            indicators, protection_score = self.analyze_response_for_protection(
                response.text, response.status_code, url
            )
            
            return {
                'html': response.text,
                'title': '',
                'url': response.url,
                'status_code': response.status_code,
                'performance': {'loadComplete': load_time},
                'method': 'requests_basic',
                'protection_detected': protection_score > 30,
                'protection_score': protection_score,
                'protection_indicators': indicators
            }
            
        except Exception as e:
            raise Exception(f"Basic requests scraping failed: {str(e)}")

    async def scrape_with_playwright_minimal(self, url, timeout=12, headless=True):
        """Minimal Playwright for when requests fails"""
        try:
            from playwright.async_api import async_playwright
            
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    headless=headless,
                    args=[
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--disable-extensions',
                        '--disable-logging',
                        '--silent',
                        '--log-level=3',
                        '--disable-background-networking',
                        '--disable-sync',
                        '--no-first-run'
                    ]
                )
                
                context = await browser.new_context(
                    viewport={'width': 1366, 'height': 768},
                    user_agent=random.choice(self.user_agents),
                    ignore_https_errors=True
                )
                
                page = await context.new_page()
                
                # Block heavy resources
                await page.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,otf,mp4,mp3,avi,mov,webm,pdf}", lambda route: route.abort())
                
                try:
                    response = await page.goto(
                        url, 
                        wait_until='domcontentloaded',
                        timeout=timeout * 1000
                    )
                    
                    if not response:
                        raise Exception("No response received")
                    
                    # Quick content grab
                    html_content = await page.content()
                    final_title = await page.title()
                    final_url = page.url
                    status_code = response.status
                    
                    await browser.close()
                    
                    # Analyze protection
                    indicators, protection_score = self.analyze_response_for_protection(
                        html_content, status_code, url
                    )
                    
                    return {
                        'html': html_content,
                        'title': final_title,
                        'url': final_url,
                        'status_code': status_code,
                        'performance': {'loadComplete': timeout * 500},
                        'method': 'playwright_minimal',
                        'protection_detected': protection_score > 20,
                        'protection_score': protection_score,
                        'protection_indicators': indicators
                    }
                    
                except Exception as e:
                    await browser.close()
                    raise e
                    
        except ImportError:
            raise Exception("Playwright not available")
        except Exception as e:
            raise Exception(f"Playwright minimal scraping failed: {str(e)}")

    def extract_seo_data_fast(self, scraped_data):
        """Fast SEO extraction focusing on core data"""
        try:
            from bs4 import BeautifulSoup
            
            html = scraped_data['html']
            if not html or len(html.strip()) == 0:
                raise Exception("Empty HTML content")
            
            # Use fastest parser available
            soup = BeautifulSoup(html, 'lxml' if 'lxml' in str(BeautifulSoup.get_available_parsers()) else 'html.parser')
            
            # Quick title extraction
            title = scraped_data.get('title', '')
            if not title:
                title_tag = soup.find('title')
                title = title_tag.get_text().strip() if title_tag else ''
            
            # Quick meta description
            meta_desc = ''
            meta_desc_tag = soup.find('meta', attrs={'name': 'description'})
            if meta_desc_tag:
                meta_desc = meta_desc_tag.get('content', '').strip()
            
            # Quick content extraction
            for script in soup(["script", "style"]):
                script.decompose()
            
            # Try to get main content
            main_content = soup.find('main') or soup.find('article') or soup.find('body')
            content = main_content.get_text(separator=' ', strip=True) if main_content else ''
            
            # Limit for performance
            if len(content) > 5000:
                content = content[:5000] + "..."
            
            word_count = len(content.split()) if content else 0
            
            # Quick scoring
            title_score = 10 if 30 <= len(title) <= 60 else (6 if len(title) > 0 else 0)
            meta_desc_score = 10 if 80 <= len(meta_desc) <= 160 else (6 if len(meta_desc) > 0 else 0)
            content_score = 10 if word_count >= 300 else (6 if word_count >= 100 else 2)
            
            # Calculate overall SEO score
            avg_score = (title_score + meta_desc_score + content_score) / 3
            seo_score = max(0, min(100, round(avg_score * 10)))
            
            # Determine grade
            if seo_score >= 90:
                seo_grade = "A"
            elif seo_score >= 80:
                seo_grade = "B"
            elif seo_score >= 70:
                seo_grade = "C"
            elif seo_score >= 60:
                seo_grade = "D"
            else:
                seo_grade = "F"
            
            # Build streamlined result
            result = {
                'url': scraped_data['url'],
                'pageUrl': scraped_data['url'],
                'websiteUrl': self.get_website_url(scraped_data['url']),
                'statusCode': scraped_data.get('status_code', 200),
                'lastCrawled': datetime.now().isoformat(),
                'scrapedAt': datetime.now().isoformat(),
                'method': scraped_data['method'],
                'processingMethod': scraped_data['method'],
                
                # Core content
                'title': title,
                'metaDescription': meta_desc,
                'content': content,
                'wordCount': word_count,
                
                # Scores
                'titleLength': len(title),
                'titleScore': title_score,
                'metaDescriptionLength': len(meta_desc),
                'metaDescriptionScore': meta_desc_score,
                'contentScore': content_score,
                'seoScore': seo_score,
                'seoGrade': seo_grade,
                
                # Protection info
                'protection_detected': scraped_data.get('protection_detected', False),
                'protection_score': scraped_data.get('protection_score', 0),
                'protection_indicators': scraped_data.get('protection_indicators', {}),
                
                # Minimal required structure
                'titleIssues': {'missing': not title, 'tooShort': len(title) < 30, 'tooLong': len(title) > 60, 'multiple': False, 'duplicate': False},
                'metaDescriptionIssues': {'missing': not meta_desc, 'tooShort': len(meta_desc) < 80, 'tooLong': len(meta_desc) > 160, 'multiple': False, 'duplicate': False},
                'contentIssues': {'tooShort': word_count < 300, 'lowKeywordDensity': False, 'poorReadability': False},
                'urlIssues': {'tooLong': len(scraped_data['url']) > 75, 'containsSpecialChars': False, 'containsParams': '?' in scraped_data['url'], 'nonDescriptive': False, 'hasSpaces': False, 'hasUnderscores': False, 'tooManySubdirectories': False},
                
                'readabilityScore': 70,
                'urlScore': 8,
                
                # Minimal structure data
                'headingStructure': {'h1Count': len(soup.find_all('h1')), 'h2Count': len(soup.find_all('h2')), 'h3Count': 0, 'h4Count': 0, 'h5Count': 0, 'h6Count': 0, 'h1Missing': len(soup.find_all('h1')) == 0, 'h1Multiple': len(soup.find_all('h1')) > 1, 'h2H3AtTop': False, 'headingTexts': {}, 'headingScore': 8},
                'images': {'totalCount': len(soup.find_all('img')), 'withAlt': 0, 'withTitle': 0, 'withDimensions': 0, 'lazyLoaded': 0, 'responsive': 0, 'altTextMissing': [], 'oversizedImages': [], 'unoptimizedImages': [], 'nextGenFormats': 0, 'score': 8},
                'links': {'totalCount': len(soup.find_all('a')), 'internalCount': 0, 'externalCount': 0, 'socialMediaCount': 0, 'noFollowCount': 0, 'emailLinks': 0, 'phoneLinks': 0, 'downloadLinks': 0, 'brokenLinks': [], 'redirectLinks': [], 'httpLinks': [], 'socialMediaLinks': [], 'longUrls': [], 'emptyLinks': [], 'score': 8},
                'technicalSeo': {'canonicalTagExists': bool(soup.find('link', rel='canonical')), 'canonicalUrl': '', 'robotsDirectives': '', 'hreflangTags': [], 'structuredData': bool(soup.find('script', type='application/ld+json')), 'structuredDataTypes': [], 'hasViewport': bool(soup.find('meta', attrs={'name': 'viewport'})), 'hasCharset': bool(soup.find('meta', attrs={'charset': True})), 'htmlSize': len(html), 'technicalScore': 8},
                'performance': {'pageSize': len(html) / 1024, 'transferSize': len(html) / 1024, 'mobileOptimized': {'hasViewport': bool(soup.find('meta', attrs={'name': 'viewport'})), 'viewportContent': '', 'isResponsive': True, 'hasMediaQueries': '@media' in html}, 'compressionEnabled': False, 'cacheHeaders': {}, 'resources': {'externalScriptsCount': 0, 'externalStylesCount': 0, 'asyncScriptsCount': 0, 'inlineScriptsCount': 0, 'inlineStylesCount': 0}, 'timingMetrics': {'domContentLoaded': 2, 'loadComplete': 3}, 'webVitals': {'estimatedLCP': 2.5, 'estimatedFID': 100, 'estimatedCLS': 0.1, 'lcpRating': 'good', 'fidRating': 'good', 'clsRating': 'good'}, 'score': 8},
                'contentQuality': {'spellingErrors': [], 'grammarErrors': [], 'duplicateContent': [], 'contentQualityScore': 8},
                'duplicates': {'titleDuplicates': [], 'descriptionDuplicates': [], 'contentDuplicates': []},
                
                'individualScores': {'titleScore': title_score, 'metaDescriptionScore': meta_desc_score, 'contentScore': content_score, 'headingScore': 8, 'urlScore': 8, 'technicalScore': 8, 'imageScore': 8, 'linkScore': 8, 'performanceScore': 8, 'contentQualityScore': 8},
                'seoScoreComponents': {'titleWeight': 0.15, 'metaDescriptionWeight': 0.15, 'contentWeight': 0.20, 'headingsWeight': 0.10, 'urlWeight': 0.05, 'technicalWeight': 0.10, 'imagesWeight': 0.05, 'linksWeight': 0.05, 'performanceWeight': 0.10, 'contentQualityWeight': 0.05}
            }
            
            return result
            
        except Exception as e:
            raise Exception(f"Fast SEO data extraction failed: {str(e)}")

    async def scrape_url_adaptive(self, url, method='auto', timeout=15, headless=True):
        """Main adaptive scraping method"""
        
        strategies = {
            'requests': [('requests_basic', 8)],
            'requests_first': [('requests_smart', 10), ('playwright_minimal', 12)],
            'auto': [('requests_smart', 10), ('playwright_minimal', 12)],
            'playwright': [('playwright_minimal', 12), ('requests_smart', 10)],
            'selenium': [('requests_smart', 10)]  # Fallback to requests for selenium requests
        }
        
        # Get strategy list
        strategy_list = strategies.get(method, strategies['auto'])
        
        last_error = None
        
        for strategy_name, strategy_timeout in strategy_list:
            try:
                # Use strategy-specific timeout or provided timeout
                actual_timeout = min(strategy_timeout, timeout)
                
                if strategy_name == 'requests_basic':
                    scraped_data = await self.scrape_with_requests_basic(url, actual_timeout)
                elif strategy_name == 'requests_smart':
                    scraped_data = await self.scrape_with_requests_smart(url, actual_timeout)
                elif strategy_name == 'playwright_minimal':
                    scraped_data = await self.scrape_with_playwright_minimal(url, actual_timeout, headless)
                else:
                    continue
                
                return self.extract_seo_data_fast(scraped_data)
                
            except Exception as e:
                last_error = str(e)
                continue
        
        # If all methods fail
        return {
            'url': url,
            'error': f'All adaptive methods failed. Last error: {last_error}',
            'lastCrawled': datetime.now().isoformat(),
            'scrapedAt': datetime.now().isoformat(),
            'method': 'failed',
            'protection_detected': True,
            'protection_score': 100
        }

def main():
    """Main entry point with timeout handling"""
    parser = argparse.ArgumentParser(description='Adaptive SEO Scraper')
    parser.add_argument('url', help='URL to scrape')
    parser.add_argument('--method', default='auto', choices=['auto', 'requests', 'requests_first', 'playwright', 'selenium'], help='Scraping method')
    parser.add_argument('--timeout', type=int, default=15, help='Timeout in seconds')
    parser.add_argument('--headless', type=bool, default=True, help='Run in headless mode')
    parser.add_argument('--user-agent', help='Custom user agent')
    parser.add_argument('--max-retries', type=int, default=1, help='Max retries (ignored)')
    parser.add_argument('--delay', type=float, default=0.5, help='Delay between requests (ignored)')
    parser.add_argument('--client-ip', help='Client IP address') 
    args = parser.parse_args()
    
    def timeout_handler(signum, frame):
        raise TimeoutError(f"Script timed out after {args.timeout + 3} seconds")
    
    # Set up timeout signal
    if hasattr(signal, 'SIGALRM'):
        signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(args.timeout + 3)
    
    try:
        url = args.url.strip()
        
        # Add https if no protocol
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        
        result = scrape_webpage(args.url, args)


        if args.client_ip:
            result['clientIp'] = args.client_ip
            result['clientInfo'] = f'Client IP: {args.client_ip}'
        
        # Validate URL
        try:
            parsed = urlparse(url)
            if not parsed.netloc:
                raise ValueError("Invalid URL")
        except Exception:
            result = {
                'error': 'Invalid URL format',
                'url': url,
                'lastCrawled': datetime.now().isoformat(),
                'scrapedAt': datetime.now().isoformat(),
            }
            print(json.dumps(result, ensure_ascii=False))
            sys.exit(1)
        
        # Create scraper and process
        scraper = AdaptiveScraper()
        
        result = asyncio.run(scraper.scrape_url_adaptive(url, args.method, args.timeout, args.headless))
        
        print(json.dumps(result, ensure_ascii=False))
        
    except (TimeoutError, KeyboardInterrupt):
        result = {
            'error': f'Process timed out after {args.timeout} seconds',
            'url': args.url if 'args' in locals() else '',
            'lastCrawled': datetime.now().isoformat(),
            'scrapedAt': datetime.now().isoformat(),
        }
        print(json.dumps(result))
        sys.exit(1)
    except Exception as e:
        result = {
            'error': f'Script error: {str(e)}',
            'url': args.url if 'args' in locals() else '',
            'lastCrawled': datetime.now().isoformat(),
            'scrapedAt': datetime.now().isoformat(),
        }
        print(json.dumps(result))
        sys.exit(1)
    finally:
        if hasattr(signal, 'SIGALRM'):
            signal.alarm(0)

if __name__ == "__main__":
    main()