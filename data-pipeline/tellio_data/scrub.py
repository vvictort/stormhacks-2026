"""PII / URL / brand scrubbing and junk filtering for excerpt text.

Tagging runs AFTER this, on its output.
"""

import hashlib
import html
import re
from email.header import decode_header, make_header
from urllib.parse import urlsplit

MAX_TEXT = 1200
MAX_SUBJECT = 200

# Invented hosts under the reserved .example TLD (RFC 2606) so nothing can resolve.
# Suspicious-looking originals keep a suspicious-looking replacement (the keywords
# tagging.py looks for); ordinary ones get a bland host.
SUSPICIOUS_HOSTS = (
    'secure-account-verify.example',
    'login-update-center.example',
    'account-verification.example',
    'client-security-check.example',
    'verify-identity-portal.example',
)
PLAIN_HOST = 'links.example'
SHORTENERS = ('bit.ly', 'tinyurl', 'goo.gl', 'ow.ly', 't.co', 'is.gd')
HOST_RED_FLAGS = re.compile(
    r'secure|login|log-in|signin|verify|account|update|confirm|webscr|bank|wallet|support|'
    r'paypal|ebay|apple|amazon|microsoft|chase|wells|usaa|irs',
    re.I,
)
GENERIC_LOCAL = {
    'support',
    'service',
    'noreply',
    'no-reply',
    'admin',
    'security',
    'info',
    'help',
    'billing',
    'account',
    'accounts',
    'alert',
    'alerts',
    'customerservice',
    'webmaster',
    'team',
    'contact',
}

# Real brands -> bracketed generic roles (the call dataset already uses [Company]-style
# placeholders). Entries written in ALL CAPS match case-sensitively (UPS != "sign ups");
# the rest ignore case.
BRANDS = {
    '[Bank]': [
        'Bank of America',
        'Wells Fargo',
        'JPMorgan',
        'Chase Bank',
        'Chase',
        'Citibank',
        'HSBC',
        'Barclays',
        'Lloyds TSB',
        'Lloyds',
        'NatWest',
        'Halifax',
        'Santander',
        'USAA',
        'Capital One',
        'TD Bank',
        'RBC',
        'Scotiabank',
        'BMO',
        'CIBC',
        'Fifth Third',
        'Regions Bank',
        'SunTrust',
        'Washington Mutual',
        'WaMu',
        'National City',
        'Wachovia',
        'Comerica',
        'Nationwide',
        'Huntington',
        'KeyBank',
        'PNC',
        'Desjardins',
        'Bank of the West',
        'Abbey National',
        'Commerce Bank',
        'Navy Federal Credit Union',
        'Navy Federal',
        'Standard Bank',
        'Discover Bank',
        'Charles Schwab',
        'Schwab',
    ],
    '[Payment Service]': [
        'PayPal',
        'Venmo',
        'Zelle',
        'Cash App',
        'Western Union',
        'MoneyGram',
        'e-gold',
    ],
    '[Card Network]': [
        'MasterCard',
        'American Express',
        'Amex',
        'Discover Card',
        'Visa',
    ],
    '[Online Store]': [
        'Amazon',
        'eBay',
        'Walmart',
        'Alibaba',
        'Best Buy',
        'Costco',
        'JCPenney',
        "Macy's",
        'Trade Me',
    ],
    '[News Site]': ['Cable News Network', 'CNN'],
    '[Tech Company]': [
        'Microsoft',
        'Apple',
        'Google',
        'Facebook',
        'Instagram',
        'WhatsApp',
        'Netflix',
        'iTunes',
        'iCloud',
        'Adobe',
        'Dropbox',
        'DocuSign',
        'LinkedIn',
        'Twitter',
        'Skype',
        'Cyberoam',
    ],
    '[Email Provider]': [
        'Yahoo',
        'Gmail',
        'Hotmail',
        'Outlook',
        'Office 365',
        'AOL',
        'Windows Live',
    ],
    '[Tax Agency]': [
        'Internal Revenue Service',
        'IRS',
        'HMRC',
        'HM Revenue',
        'Canada Revenue Agency',
        'CRA',
    ],
    '[Government Agency]': [
        'Social Security Administration',
        'FBI',
        'Homeland Security',
    ],
    '[Courier]': [
        'FedEx',
        'UPS',
        'DHL',
        'USPS',
        'Royal Mail',
        'Canada Post',
        'Purolator',
    ],
}
_BRAND_RES = [
    (
        re.compile(
            rf'(?<![\w\[]){re.escape(name)}(?![\w\]])', 0 if name.isupper() else re.I
        ),
        role,
    )
    for role, names in BRANDS.items()
    for name in sorted(names, key=len, reverse=True)
]

# Mailbox owners that recur throughout the source corpora (e.g. the Nazario honeypot
# "jose@monkey.org").
KNOWN_NAMES = re.compile(r'\b(jose|monkey)\b', re.I)
GREETING_OK = {
    'Customer',
    'Member',
    'User',
    'Client',
    'Sir',
    'Madam',
    'Friend',
    'Valued',
    'Account',
    'Beneficiary',
    'Colleague',
    'All',
    'Team',
    'Card',
    'Holder',
    'Cardholder',
    'There',
    'Online',
    'Email',
    'Webmail',
}

JUNK_MARKERS = re.compile(
    r'Return-Path:|Received: from|X-Original-To:|Content-Transfer-Encoding|=3D|=20\b|'
    r'internal format of your mail folder|BEGIN PGP|base64',
    re.I,
)
# Pharma/adult/replica spam teaches nothing about the scams Tellio trains for (and is
# unfit for a demo).
OFF_TOPIC = re.compile(
    r'viagra|cialis|levitra|tramadol|phentermine|penis|libido|erection|male enhancement|'
    r'\bsex\w*|porn|replica|rolex|\bpills?\b|\bmeds\b|pharmacy|love (?:wand|gun|stick)|\blover\b|manhood|'
    r'potency|enlarge|weight loss',
    re.I,
)
# Mailing-list chatter (quoted replies, list footers) is personal correspondence, not a
# useful "safe" example.
LIST_TRAFFIC = re.compile(
    r'^>|mailing list|unsubscribe from this (?:list|group)|^-- ?$', re.I | re.M
)
STOPWORDS = set(
    'the to you your and of a in is for this we our be please on with that have are it will not'.split()
)

URL_RE = re.compile(r'(?:https?://|www\.)[^\s<>"\'\)\]]+', re.I)
EMAIL_RE = re.compile(r'\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)\b')
DOMAIN_RE = re.compile(
    r'\b(?:[a-z0-9-]+\.)+(?:com|net|org|info|biz|us|uk|ca|ru|cn|de|io|me|au)\b(?!\.\w)',
    re.I,
)
PHONE_RE = re.compile(
    r'(?<!\d)(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}(?!\d)'
)
LONG_NUMBER_RE = re.compile(r'\b\d{6,}\b')
ADDRESS_RE = re.compile(
    r'\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|'
    r'Drive|Dr|Court|Ct|Way|Suite|Highway|Hwy|Parkway|Pkwy|Place|Pl)\b\.?(?: (?:North|South|East|West))?|'
    r'\bP\.?\s?O\.?\s+Box\s+\d+|\b\d{3,6} [NSEW]\b|\b[A-Z][a-z]+, [A-Z]{2} \d{5}(?:-\d{4})?\b'
)
GREETING_RE = re.compile(
    r'\b(Dear|Hi|Hello|Attn:?)\s+((?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+)?'
    r'([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})(?!\w)'
)
# "Dear hulkjr ,"
HANDLE_GREETING_RE = re.compile(r'\b(Dear|Hi|Hello) ([a-z][\w.]{2,20})(\s*,)')
SELF_INTRO_RE = re.compile(
    r'\b(My name is|I am|I\'m) (?:(?:Mr|Mrs|Ms|Dr|Barrister)\.? )?[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}\b'
)
HONORIFIC_RE = re.compile(
    r'\b(Mr|Mrs|Ms|Miss|Dr|Prof|Barrister)\.? [A-Z][a-z]+(?: [A-Z][a-z]+){0,2}\b'
)
# a bare first name signing off at the end
LONE_NAME_RE = re.compile(r'\n(?:-- ?\n)?[A-Z][a-z]{2,15}\.?\s*$')
SIGNOFF_RE = re.compile(
    r'\b(Regards|Sincerely|Best wishes|Yours truly|Thanks|Thank you),?\s+([A-Z][a-z]+\s+[A-Z][a-z]+)\b'
)


def _pick(options, key: str) -> str:
    return options[int(hashlib.sha1(key.encode()).hexdigest(), 16) % len(options)]


def neutralize_url(url: str, scam: bool = True) -> str:
    raw = url if '://' in url else 'http://' + url
    try:
        parts = urlsplit(raw)
        host = (parts.hostname or '').lower()
    except ValueError:
        host, parts = '', None
    suspicious = (
        not host
        or re.fullmatch(r'[\d.]+', host)
        or '@' in url
        or 'xn--' in host
        or host.count('.') > 3
        or host.count('-') >= 2
        or any(s in host for s in SHORTENERS)
        or HOST_RED_FLAGS.search(host)
    )
    new_host = _pick(SUSPICIOUS_HOSTS, host) if suspicious and scam else PLAIN_HOST
    segments = [
        s
        for s in (parts.path.split('/') if parts else [])
        if re.fullmatch(r'[A-Za-z-]{2,15}', s)
        and not any(p.search(s) for p, _ in _BRAND_RES)
    ][:2]
    scheme = 'https' if raw.lower().startswith('https') else 'http'
    return f'{scheme}://{new_host}/' + '/'.join(segments)


def _url(m: re.Match, scam: bool) -> str:
    url = m.group(0).rstrip('.,;:!?')
    return neutralize_url(url, scam) + m.group(0)[len(url) :]


def _email(m: re.Match) -> str:
    local = m.group(1) if m.group(1).lower() in GENERIC_LOCAL else 'user'
    return f'{local}@mail.example'


def _greeting(m: re.Match) -> str:
    return (
        m.group(0)
        if {w.title() for w in m.group(3).split()} & GREETING_OK
        else f'{m.group(1)} Customer'
    )


def _signoff(m: re.Match) -> str:
    return (
        m.group(0) if set(m.group(2).split()) & GREETING_OK else f'{m.group(1)}, [Name]'
    )


def decode_mime(text: str) -> str:
    """'=?UTF-8?B?...?=' encoded words (common in subjects) -> text."""
    if '=?' not in text:
        return text
    try:
        return str(make_header(decode_header(text)))
    except Exception:  # noqa: BLE001 - malformed headers stay as they were
        return text


def strip_markup(text: str) -> str:
    text = re.sub(r'<(style|script)\b.*?</\1>', ' ', text, flags=re.S | re.I)
    text = re.sub(r'<br\s*/?>|</p>|</div>|</tr>', '\n', text, flags=re.I)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', text))
    text = text.replace('\r', '').replace('\xa0', ' ')
    # wide gaps were layout breaks in the flattened HTML
    text = re.sub(r'[ \t]{3,}', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r' *\n[ \n]*', '\n', text).strip()
    text = re.sub(
        r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{16,}\b',
        '',
        text,
    )
    # HTML + plain-text parts are often both flattened into the body: keep the first
    # copy only.
    repeat = text.find(text[:40], 40) if len(text) > 200 else -1
    return text[:repeat].strip() if repeat > 0 else text


def scrub_text(text: str, scam: bool = True) -> str:
    """Legitimate rows never get a suspicious-looking replacement host."""
    text = URL_RE.sub(lambda m: _url(m, scam), strip_markup(decode_mime(text)))
    text = EMAIL_RE.sub(_email, text)
    text = DOMAIN_RE.sub(
        lambda m: (
            m.group(0) if m.group(0).lower().endswith('.example') else 'mail.example'
        ),
        text,
    )
    text = PHONE_RE.sub('555-0100', text)  # 555-01xx is reserved for fiction
    text = LONG_NUMBER_RE.sub('[number]', text)
    text = ADDRESS_RE.sub('[street address]', text)
    text = GREETING_RE.sub(_greeting, text)
    text = HANDLE_GREETING_RE.sub(
        lambda m: (
            m.group(0)
            if m.group(2).title() in GREETING_OK
            else f'{m.group(1)} Customer{m.group(3)}'
        ),
        text,
    )
    text = SIGNOFF_RE.sub(_signoff, text)
    text = LONE_NAME_RE.sub('\n[Name]', text)
    text = SELF_INTRO_RE.sub(lambda m: f'{m.group(1)} [Name]', text)
    text = HONORIFIC_RE.sub(lambda m: f'{m.group(1)} [Name]', text)
    text = KNOWN_NAMES.sub('user', text)
    for pattern, role in _BRAND_RES:
        text = pattern.sub(role, text)
    return text


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    cut = cut[: cut.rfind(' ')] if ' ' in cut[limit // 2 :] else cut
    return cut.rstrip(' ,;:\n') + '…'


def is_junk(text: str) -> bool:
    words = re.findall(r"[A-Za-z']+", text)
    if len(text) < 80 or len(words) < 12 or JUNK_MARKERS.search(text):
        return True
    if sum(not c.isascii() for c in text) > 0.05 * len(text):
        return True  # mostly non-English or mojibake
    # word salad / foreign language
    return sum(w.lower() in STOPWORDS for w in words) < 0.15 * len(words)


# Characters that only appear in this data as mis-decoded bytes; such rows are dropped
# rather than guessed at.
MOJIBAKE = re.compile(r'[åÛÌÒÏ]|\ufffd')


def scrub(record: dict) -> dict | None:
    """Scrubbed copy of a raw record, or None if it is junk.

    Junk is judged before truncation.
    """
    # the UCI SMS file double-encodes £
    raw, scam = record['text'].replace('å£', '£'), record['kind'] == 'scam'
    if (
        MOJIBAKE.search(raw)
        or JUNK_MARKERS.search(raw)
        or OFF_TOPIC.search(raw)
        or OFF_TOPIC.search(record.get('subject') or '')
    ):
        return None
    if not scam and (
        LIST_TRAFFIC.search(raw)
        or re.match(r'\s*(?:re|fwd?):|\s*\[', record.get('subject') or '', re.I)
    ):
        return None
    text = scrub_text(raw, scam)
    if is_junk(text):
        return None
    subject = truncate(
        scrub_text(record.get('subject') or '', scam).replace('\n', ' '), MAX_SUBJECT
    )
    return {**record, 'text': truncate(text, MAX_TEXT), 'subject': subject}
