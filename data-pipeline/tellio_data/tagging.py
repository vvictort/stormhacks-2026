"""Deterministic Tellio tags from text: tactics, signals, cues, category, difficulty,
and pattern summaries.

Every tag comes from a regex hit, so each cue quotes the exact span that triggered it.
These are Tellio's own heuristics, kept separate from the dataset's label
(source.label).
"""

import re
from collections import Counter

from .vocabulary import SIGNALS


def _rx(body: str) -> re.Pattern:
    # (?<!\w)/(?!\w) instead of \b so alternatives may start or end with
    # "[" / "]" placeholders.
    return re.compile(rf'(?<!\w)(?:{body})(?!\w)', re.I)


OTP = (
    r'one[- ]time (?:code|password|passcode|pin)|verification code|security code|confirmation code|OTP|'
    r'\d-digit code|code (?:that )?we (?:just )?sent'
)
CREDENTIAL = (
    r'password|passcode|PIN|log-?in (?:details|credentials|information)|username|user ?name and password|'
    r'sign[- ]in details|(?:verify|confirm|validate|re-?activate) your (?:email |e-mail )?account'
)

TACTIC_RULES = {
    'otp_request': _rx(OTP),
    'info_request': _rx(
        r"social security(?: number)?|SSN|SIN number|date of birth|mother'?s maiden name|"
        r'bank (?:account )?(?:details|information|number)|account (?:details|number|information)|'
        r'credit card (?:details|information|number)|card (?:number|details)|personal (?:information|details|data)|'
        r'billing (?:information|details|address)|(?:confirm|verify|update|provide) your (?:identity|details|'
        r'information|personal information|account information)|full name|' + CREDENTIAL
    ),
    'suspicious_link': _rx(
        r'https?://\S+[\w/]|click (?:here|the link|on the link|below|the button)|follow the link|'
        r'(?:visit|open) the (?:link|website) below|log ?in (?:here|below|now)|sign in (?:here|below|now)|'
        r'verify (?:here|now)'
    ),
    'urgency': _rx(
        r'immediately|urgent(?:ly)?|right away|as soon as possible|ASAP|within (?:\d+|twenty-four) '
        r'(?:hours?|days?|minutes?)|act now|expires? (?:today|soon)|limited time|final (?:notice|warning|reminder)|'
        r"last (?:chance|warning)|don'?t delay|without delay|before it'?s too late|"
        r'(?:by|before) (?:the )?end of (?:the )?day|today only'
    ),
    'fear': _rx(
        r'suspend(?:ed|ion)?|locked(?: out)?|terminat(?:ed|ion)|deactivat(?:ed|ion)|legal action|arrest(?:ed)?|'
        r'warrant|lawsuit|prosecut\w+|penalt(?:y|ies)|late fee|consequences|compromised|virus|infected|malware|'
        r'hacked|frozen|permanently (?:deleted|disabled|closed|lost)|lose (?:access|your account)'
    ),
    'authority': _rx(
        r'police|law enforcement|\[Tax Agency\]|\[Government Agency\]|tax (?:office|department|authority)|'
        r'department of \w+|federal (?:agent|bureau|government|agency)|government (?:agency|official|department)|'
        r'court (?:order|summons|date)|legal department|compliance (?:team|department)|security (?:team|department)|'
        r'IT (?:department|support|helpdesk|help desk)|(?:system|email|e-mail|mail|server|network|IT) administrator|'
        r'official notice'
    ),
    'reward': _rx(
        r"congratulations|you(?:'ve| have) (?:won|been (?:selected|chosen|approved))|prize|winner|lottery|jackpot|"
        r'reward|bonus|free gift|gift card|cash ?back|refund|claim your \w+|inheritance|unclaimed|'
        r'million (?:dollars|USD|pounds)'
    ),
}
SIGNAL_RULES = {
    'suspicious_domain': re.compile(
        r'https?://[\w-]*(?:secure|verify|login|verification|security)[\w-]*\.example'
        r'[\w/-]*'
    ),
    'payment_request': _rx(
        r'(?:processing|upfront|advance|release|handling|transfer|customs|delivery|redelivery|shipping) fee|'
        r'wire (?:the )?(?:money|funds|transfer)|send (?:the )?(?:money|payment|funds)|make (?:a|the) payment|'
        r'payment (?:is )?(?:required|due|overdue)|outstanding (?:balance|bill|payment|amount)|gift cards?|bitcoin|'
        r'money transfer|transfer (?:the )?(?:money|funds)|pay (?:now|the fee|a fee|an? \w+ fee)'
    ),
    'credential_request': _rx(CREDENTIAL),
    'verification_code': _rx(OTP),
    'remote_access': _rx(
        r'remote (?:access|desktop|control)|access (?:to )?your (?:computer|device|PC)|'
        r'install (?:this|the|our) (?:app|application|software|program)|screen ?shar\w+|TeamViewer|AnyDesk'
    ),
    'impersonation': _rx(
        r'(?:this is|calling from|on behalf of) (?:your|the) [\w\[\] ]{2,30}?(?:bank|\]|team|department|'
        r'support|service|office)|\[(?:Bank|Payment Service|Online Store|Tech Company|Email Provider|Courier)\] '
        r'(?:security|support|customer service|team|account services|online|alert)s?|security (?:team|department|'
        r'center)|fraud (?:department|team|prevention)|account (?:services|team)|webmaster|help ?desk'
    ),
    'account_security': _rx(
        r'unusual (?:activity|sign-?in|log-?in)|suspicious (?:activity|sign-?in|log-?in|transaction)|'
        r'unauthori[sz]ed (?:access|activity|transaction|charge|log-?in)|account (?:has been|was|will be|is) '
        r'(?:temporarily )?(?:suspended|locked|limited|restricted|closed|disabled|compromised|deactivated|blocked)|'
        r'security (?:alert|notice|update|check|measure)s?|(?:sign-?in|log-?in) attempt|mailbox (?:is )?full|'
        r'quota (?:exceeded|limit)'
    ),
    'attachment': _rx(
        r'see (?:the )?attached|attached (?:file|document|invoice|form)|(?:open|download|review) the (?:attached|'
        r'attachment|document|file|invoice)|attachment'
    ),
    'social_engineering': _rx(
        r"do(?:n'?t| not) (?:tell|share this with|inform) (?:anyone|anybody|your \w+)|keep (?:this|it) "
        r"(?:confidential|secret|private|between us)|strictly confidential|it'?s me|it is me|"
        r"I(?:'m| am) in (?:trouble|jail|the hospital)|need your help urgently|god fearing|dear friend"
    ),
}
IMPLIES = {'verification_code': 'otp_request', 'credential_request': 'info_request'}
TACTIC_PRIORITY = (
    'otp_request',
    'info_request',
    'suspicious_link',
    'urgency',
    'fear',
    'authority',
    'reward',
)
MAX_TACTICS, MAX_CUES = 4, 6

CATEGORY_RULES = {
    'banking': _rx(
        r'\[Bank\]|bank(?:ing)?|debit card|credit card|\[Card Network\]|\[Payment Service\]|'
        r'account statement|transactions?|wire transfer|ATM|loan|overdraft|cardholder'
    ),
    'government': _rx(
        r'\[Tax Agency\]|\[Government Agency\]|tax(?:es)?|tax refund|government|grant|police|court|'
        r'warrant|federal|immigration|social security|jury duty|department of \w+'
    ),
    'shipping': _rx(
        r'\[Courier\]|package|parcel|deliver(?:y|ed)|shipment|shipping|shipped|tracking (?:number|code)|'
        r'courier|postal|redelivery|out for delivery'
    ),
    'account_security': _rx(
        r'password|sign-?in|log-?in|email account|e-mail account|mailbox|webmail|'
        r'\[Email Provider\]|quota|account (?:verification|suspended|locked|security)|'
        r'quarantine|unusual activity|security alert|verify your (?:email )?account|unauthori[sz]ed access'
    ),
    'workplace': _rx(
        r'payroll|HR|human resources|your (?:manager|supervisor|boss)|CEO|CFO|IT (?:department|'
        r'helpdesk|support)|help ?desk|colleagues?|employees?|staff|company (?:policy|directory)|'
        r'invoice|timesheet|salary'
    ),
    'promotional': _rx(
        r'special offer|discount|deal|sale|% off|limited (?:time )?offer|order now|buy now|shop now|'
        r'free (?:trial|gift|shipping|vacation)|subscribe|promotion|coupon|vacation package|prize|'
        r"you(?:'ve| have) won|\bwon\b|winners?|claim (?:your|yr|ur)|award(?:ed)?|vouchers?|bonus|\bdraw\b|"
        r'free entry|ringtones?|lottery|sweepstakes|lowest prices?|best prices?|replica|pills?|'
        r'pharmacy|meds|viagra|cialis'
    ),
}
# Scam types Tellio has no category for: leave them null rather than force them
# into one.
UNCATEGORIZED = _rx(
    r'next of kin|beneficiary|inheritance|late (?:husband|father|client)|barrister|diplomat|'
    r'consignment|investment|crypto\w*|bitcoin|romance|lonely|dating|grandson|granddaughter|'
    r'tech(?:nical)? support|virus|charit(?:y|able)|donation|business proposal|overseas|foreign (?:account|partner)|'
    r'transfer of (?:the )?funds?|funds? valued|million|US\$ ?\d|confidential transaction|'
    r'dormant account|deceased|my late|widow|oil (?:company|contract)'
)


def find_tags(text: str) -> dict[str, list[tuple[int, int]]]:
    """tag -> spans of every hit, for each Tactic/signal that fires."""
    hits = {}
    for tag, rx in {**TACTIC_RULES, **SIGNAL_RULES}.items():
        spans = [m.span() for m in rx.finditer(text)]
        if spans:
            hits[tag] = spans
    for signal, tactic in IMPLIES.items():
        if signal in hits and tactic not in hits:
            hits[tactic] = hits[signal]
    return hits


def split_tags(tags) -> tuple[list[str], list[str]]:
    tactics = [t for t in TACTIC_PRIORITY if t in tags][:MAX_TACTICS]
    signals = [s for s in SIGNALS if s in tags]
    return tactics, signals


def pick_cues(text: str, hits: dict, tags: list[str]) -> list[dict]:
    """One exact, non-overlapping quote per tag (tactics first), max 6, each
    3-120 chars.
    """
    cues, taken = [], []
    for tag in tags:
        for start, end in hits.get(tag, []):
            # one highlight per phrase
            fresh = text[start:end] not in {c['quote'] for c in cues}
            if (
                3 <= end - start <= 120
                and fresh
                and all(end <= a or start >= b for a, b in taken)
            ):
                cues.append({'tag': tag, 'quote': text[start:end], '_start': start})
                taken.append((start, end))
                break
        if len(cues) == MAX_CUES:
            break
    cues.sort(key=lambda c: c.pop('_start'))
    return cues


def categorize(text: str, min_score: int = 2) -> str | None:
    if UNCATEGORIZED.search(text):
        return None
    scores = sorted(
        (
            (len({m.group(0).lower() for m in rx.finditer(text)}), cat)
            for cat, rx in CATEGORY_RULES.items()
        ),
        reverse=True,
    )
    (best, cat), (second, _) = scores[0], scores[1]
    return cat if best >= min_score and best > second else None


def difficulty(kind: str, category: str | None, n_tells: int) -> str:
    if kind == 'legitimate':
        # a safe message on a scam-prone topic is the tricky one
        return 'hard' if category else 'easy'
    return 'easy' if n_tells >= 5 else 'medium' if n_tells >= 3 else 'hard'


def tag_excerpt(text: str, kind: str, category_text: str) -> dict:
    """Tags for a committed excerpt.

    Legitimate rows get a category (topic) but no tactics/signals/cues.
    """
    if kind == 'legitimate':
        category = categorize(category_text, min_score=2)
        return {
            'category': category,
            'tactics': [],
            'signals': [],
            'cues': [],
            'difficulty': difficulty(kind, category, 0),
        }
    hits = find_tags(text)
    tactics, signals = split_tags(hits)
    category = categorize(category_text)
    return {
        'category': category,
        'tactics': tactics,
        'signals': signals,
        'cues': pick_cues(text, hits, tactics + signals),
        'difficulty': difficulty(kind, category, len(tactics) + len(signals)),
    }


# Pattern summaries for derived-only sources: our own wording, chosen by keyword, never
# copied text.

ACTOR = {'call': 'Caller', 'sms': 'Text message', 'email': 'Email'}
IDENTITY = [  # (keywords in source, phrase, official?, category)
    (
        r'\bpolice\b|law enforcement|\bofficer\b|detective',
        'claims to be a police officer',
        True,
        'government',
    ),
    (
        r'\btax\b|revenue|\birs\b',
        'claims to be from the tax office',
        True,
        'government',
    ),
    (
        r'government|\bgrants?\b|federal|social security|immigration|\bcourt\b',
        'claims to be from a government agency',
        True,
        'government',
    ),
    (
        r'technical support|tech support|microsoft|virus|computer',
        'claims to be from tech support',
        False,
        None,
    ),
    (
        r'\bbank\b|credit card company|fraud department',
        'claims to be from your bank',
        False,
        'banking',
    ),
    (
        r'delivery|courier|package|parcel|shipment',
        'claims to be from a delivery company',
        False,
        'shipping',
    ),
    (
        r'internet service provider|electric|utility|phone company|gas company',
        'claims to be from a utility company',
        False,
        None,
    ),
    (r'charit|donation', 'claims to be collecting for a charity', False, None),
    (r'insurance', 'claims to be from an insurance company', False, None),
    (
        r"it is me|it's me|grandson|granddaughter|your son|your daughter|nephew|niece",
        'pretends to be a relative in trouble',
        False,
        None,
    ),
    (
        r'\bhr\b|employer|recruit|job offer|your boss|human resources',
        'claims to be from an employer or recruiter',
        False,
        'workplace',
    ),
    (
        r'hospital|clinic|pharmacy|medical|doctor',
        'claims to be from a medical provider',
        False,
        None,
    ),
]
PRETEXT = [  # (keywords, phrase, tag, category if no identity decided it)
    (
        r'\bwon\b|winner|prize|selected|congratulations|lottery|sweepstake',
        'says you were picked for a prize or payout',
        'reward',
        'promotional',
    ),
    (r'virus|malware|infected|hacked', 'says your device is infected', 'fear', None),
    (
        r'suspicious activity|unauthori|compromised|fraudulent',
        'says your account shows suspicious activity',
        'account_security',
        'account_security',
    ),
    (
        r'warrant|arrest|legal action|lawsuit|legal consequences',
        'threatens arrest or legal action',
        'fear',
        'government',
    ),
    (
        r'outstanding|you owe|unpaid|overdue|discrepanc|back taxes|irregularit',
        'says you owe money',
        'fear',
        None,
    ),
    (r'refund|overpaid|rebate', 'offers a refund', 'reward', None),
    (
        r'\bloans?\b|pre-approved',
        'says you are approved for a loan',
        'reward',
        'banking',
    ),
    (
        r'investment|returns|profit|crypto|bitcoin',
        'pitches an investment with guaranteed returns',
        'reward',
        None,
    ),
    (
        r'\bpackage\b|\bparcel\b|shipment',
        'says a delivery is on hold',
        None,
        'shipping',
    ),
    (
        r'accident|hospital|in trouble|\bjail\b|\bbail\b',
        'describes a sudden emergency',
        'social_engineering',
        None,
    ),
]
NO_CATEGORY = r"tech(?:nical)? support|virus|investment|crypto|bitcoin|charit|grandson|granddaughter|it is me|it's me"
REQUEST = [
    (
        r'one[- ]time|verification code|security code|\botp\b|code we sent',
        'asks for the one-time code',
        'otp_request',
    ),
    (
        r'password|login|credential|\bpin\b',
        'asks for login credentials',
        'credential_request',
    ),
    (
        r'social security|\bssn\b|\bsin\b',
        'asks for an ID number such as a Social Security number',
        'info_request',
    ),
    (
        r'bank account|account number|routing',
        'asks for bank account details',
        'info_request',
    ),
    (
        r'credit card|card number|card details|debit card',
        'asks for card details',
        'info_request',
    ),
    (
        r'personal information|personal details|date of birth|full name|\baddress\b',
        'asks for personal information',
        'info_request',
    ),
    (
        r'remote access|\binstall\b|access to your computer',
        'asks for remote access to the device',
        'remote_access',
    ),
    (r'gift card', 'asks to be paid in gift cards', 'payment_request'),
    (
        r'\bwire\b|transfer|bitcoin|western union|moneygram',
        'asks for a money transfer',
        'payment_request',
    ),
    (r'\bfee\b|payment|\bpay\b', 'asks for a payment up front', 'payment_request'),
    (r'\blink\b|website|\bclick\b', 'sends a link to follow', 'suspicious_link'),
]
PRESSURE = [
    ('urgency', 'pushes for action right away'),
    ('fear', 'warns of consequences for refusing'),
    ('social_engineering', 'asks to keep it secret'),
    ('authority', 'leans on official authority'),
    ('reward', 'dangles a reward'),
]
LEGIT_WHO = [
    (r'utilit|electric|water|gas company', 'a utility company'),
    (r'pharmac', 'a pharmacy'),
    (r'clinic|medical|dental|hospital|doctor', 'a medical office'),
    (r'bank', 'your bank'),
    (r'retail|store|order|shop', 'a store'),
    (r'library', 'the library'),
    (r'school|universit', 'a school'),
    (r'insurance', 'an insurance company'),
    (r'delivery|courier', 'a delivery company'),
]
LEGIT_WHY = [
    (r'appointment|schedule', 'confirms or schedules an appointment'),
    (r'shipped|delivery|order', 'gives an order or delivery update'),
    (r'refill|prescription', 'offers a prescription refill'),
    (r'survey|feedback', 'asks for feedback'),
    (r'transaction|routine', 'mentions a routine account check'),
    (r'due|reminder|renew|expire', 'gives a reminder'),
]


def _first(rules, text):
    return next((r for r in rules if re.search(r[0], text, re.I)), None)


def pattern(source_text: str, kind: str, channel: str) -> dict:
    """A short step summary written by this code from keyword hits; cues quote our own
    step phrases.
    """
    actor = ACTOR[channel]
    category = categorize(source_text, min_score=2 if kind == 'scam' else 3)
    if kind == 'legitimate':
        who, why = _first(LEGIT_WHO, source_text), _first(LEGIT_WHY, source_text)
        text = (
            f'{actor} says they are from {who[1] if who else "a local business"} -> '
            f'{why[1] if why else "shares a routine update"}.'
        )
        return {
            'category': category,
            'tactics': [],
            'signals': [],
            'cues': [],
            'text': text,
            'difficulty': difficulty(kind, category, 0),
        }

    tags = set(find_tags(source_text))
    steps = []  # (phrase, tag or None)
    ident = _first(IDENTITY, source_text)
    if ident:
        tag = 'authority' if ident[2] else 'impersonation'
        steps.append((ident[1], tag))
        tags.add(tag)
    else:
        steps.append(
            (
                'makes an unsolicited approach'
                if channel != 'call'
                else 'calls out of the blue',
                None,
            )
        )
    pretexts = [r for r in PRETEXT if re.search(r[0], source_text, re.I)][:2]
    if re.search(NO_CATEGORY, source_text, re.I):
        category = None
    elif ident:
        category = ident[3]
    else:
        category = next((r[3] for r in pretexts if r[3]), category)
    steps += [(p, t) for _, p, t, _ in pretexts]
    per_tag, requests = Counter(t for _, t in steps), 0
    for (
        keywords,
        p,
        t,
    ) in REQUEST:  # up to 3 asks, one per tag (two kinds of personal details allowed)
        if (
            requests < 3
            and per_tag[t] < (2 if t == 'info_request' else 1)
            and re.search(keywords, source_text, re.I)
        ):
            steps.append((p, t))
            per_tag[t] += 1
            requests += 1
    tags |= {t for _, t in steps if t}
    tags |= {tactic for signal, tactic in IMPLIES.items() if signal in tags}
    used = {t for _, t in steps}
    steps += [(p, t) for t, p in PRESSURE if t in tags and t not in used][:2]

    tactics, signals = split_tags(tags)
    text = f'{actor} ' + ' -> '.join(p for p, _ in steps) + '.'
    final = set(tactics) | set(signals)
    cues = [{'tag': t, 'quote': p} for p, t in steps if t in final][:MAX_CUES]
    return {
        'category': category,
        'tactics': tactics,
        'signals': signals,
        'cues': cues,
        'text': text,
        'difficulty': difficulty(kind, category, len(tactics) + len(signals)),
    }
