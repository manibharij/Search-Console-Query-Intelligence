### Prerequisites
- Python 3.9+
- pip

### 1. Clone the repository
git clone https://github.com/your-username/search-console-query-intelligence.git
cd search-console-query-intelligence

### 2. Install dependencies
pip install -r requirements.txt

### 3. Run the analysis
python gsc_query_intelligence.py --input path/to/gsc_export.csv --out output/

### Supported Input
- Google Search Console Queries export (CSV)
- Required columns: Query, Clicks, Impressions, CTR, Position
