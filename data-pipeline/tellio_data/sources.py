"""Dataset registry.

Licences were read from each dataset's Kaggle page on 2026-10-04.
"""

SOURCES = {
    'email': {
        'dataset': 'naserabdullahalam/phishing-email-dataset',
        'kind': 'dataset',
        'url': 'https://www.kaggle.com/datasets/naserabdullahalam/phishing-email-dataset',
        'license': 'CC BY-SA 4.0',
        # Attribution + ShareAlike: scrubbed excerpts may be committed; the excerpts
        # stay CC BY-SA 4.0.
        'redistribution': 'excerpts',
        # phishing_email.csv is a merge of the others, and Enron/Ling are full of real
        # personal mail; skipped.
        'files': (
            'Nazario.csv',
            'CEAS_08.csv',
            'SpamAssasin.csv',
            'Nigerian_Fraud.csv',
        ),
    },
    'sms': {
        # The UCI SMS Spam Collection (an input of the same Kaggle notebook as the email
        # data). The preferred spam-detection-challenge competition needs a Kaggle login
        # and accepted rules, so it isn't used yet.
        'dataset': 'uciml/sms-spam-collection-dataset',
        'kind': 'dataset',
        'url': 'https://archive.ics.uci.edu/dataset/228/sms+spam+collection',
        # Kaggle lists "Unknown"; the UCI ML Repository (the origin) publishes it under
        # CC BY 4.0, read 2026-10-04.
        'license': 'CC BY 4.0',
        'redistribution': 'excerpts',
        'files': ('spam.csv',),
    },
    'call': {
        'dataset': 'teeconnie/scam-and-non-scam-call-conversation-dataset',
        'kind': 'dataset',
        'url': 'https://www.kaggle.com/datasets/teeconnie/scam-and-non-scam-call-conversation-dataset',
        'license': 'CC BY-NC-ND 4.0',
        # NoDerivatives: no transcript text, not even edited; only code-generated
        # pattern summaries of tags.
        'redistribution': 'derived-only',
        'files': ('English_Scam.txt', 'English_NonScam.txt'),
    },
}
