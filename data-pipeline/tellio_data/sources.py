"""Dataset registry. Licences were read from each dataset's Kaggle page on 2026-10-04."""

SOURCES = {
    'email': {
        'dataset': 'naserabdullahalam/phishing-email-dataset',
        'kind': 'dataset',
        'url': 'https://www.kaggle.com/datasets/naserabdullahalam/phishing-email-dataset',
        'license': 'CC BY-SA 4.0',
        # Attribution + ShareAlike: scrubbed excerpts may be committed; the excerpts stay CC BY-SA 4.0.
        'redistribution': 'excerpts',
        # phishing_email.csv is a merge of the others, and Enron/Ling are full of real personal mail; skipped.
        'files': ('Nazario.csv', 'CEAS_08.csv', 'SpamAssasin.csv', 'Nigerian_Fraud.csv'),
    },
    'sms': {
        'dataset': 'spam-detection-challenge',
        'kind': 'competition',
        'url': 'https://www.kaggle.com/competitions/spam-detection-challenge',
        # Competition data: needs a Kaggle login and accepted rules; the rules govern reuse, so no text is committed.
        'license': 'Kaggle competition rules (unverified; login required)',
        'redistribution': 'derived-only',
        'files': (),
    },
    'call': {
        'dataset': 'teeconnie/scam-and-non-scam-call-conversation-dataset',
        'kind': 'dataset',
        'url': 'https://www.kaggle.com/datasets/teeconnie/scam-and-non-scam-call-conversation-dataset',
        'license': 'CC BY-NC-ND 4.0',
        # NoDerivatives: no transcript text, not even edited; only code-generated pattern summaries of tags.
        'redistribution': 'derived-only',
        'files': ('English_Scam.txt', 'English_NonScam.txt'),
    },
}
