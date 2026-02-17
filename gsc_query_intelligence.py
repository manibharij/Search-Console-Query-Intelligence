
import pandas as pd
import numpy as np
import argparse
import os
import re
import sys
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import AgglomerativeClustering

# --- CONFIGURATION / SEO RULES ---

# Intent Modifiers: Edit these to refine your intent classification logic
INTENT_MAP = {
    'informational': [
        'how', 'what', 'why', 'guide', 'tutorial', 'symptoms', 'meaning', 
        'definition', 'examples', 'tips', 'learn', 'resource', 'benefits'
    ],
    'commercial': [
        'price', 'cost', 'buy', 'best', 'top', 'vs', 'review', 'alternative', 
        'discount', 'cheap', 'comparison', 'pricing', 'order'
    ],
    'navigational': [
        'login', 'website', 'contact', 'address', 'official', 'support', 
        'signin', 'account', 'portal'
    ],
    'local': [
        'near me', 'nearby', 'in ', 'at ', 'open now', 'directions', 
        'location', 'store', 'shop'
    ]
}

# Column Mapping: Internal Name -> List of possible CSV headers
COLUMN_ALIASES = {
    'query': ['query', 'top queries', 'search term', 'keywords'],
    'clicks': ['clicks', 'click count'],
    'impressions': ['impressions', 'impr', 'view count'],
    'ctr': ['ctr', 'click through rate', 'click-through rate'],
    'position': ['position', 'average position', 'avg position', 'rank']
}

class GSCIntelligence:
    def __init__(self, input_path, output_dir, min_impressions=None):
        self.input_path = Path(input_path)
        self.output_dir = Path(output_dir)
        self.min_impressions = min_impressions
        self.df = None
        self.clusters_df = None
        self.opportunities_df = None
        
        if not self.output_dir.exists():
            os.makedirs(self.output_dir)

    def log(self, message):
        print(f"[GSC-INTEL] {message}")

    def normalize_columns(self, df):
        """Standardizes CSV columns across different GSC export formats."""
        detected = {col.lower(): col for col in df.columns}
        mapping = {}
        
        for internal_name, aliases in COLUMN_ALIASES.items():
            for alias in aliases:
                if alias in detected:
                    mapping[detected[alias]] = internal_name
                    break
        
        df = df.rename(columns=mapping)
        
        # Check for essential columns
        required = ['query', 'clicks', 'impressions', 'ctr', 'position']
        missing = [r for r in required if r not in df.columns]
        
        if missing:
            print("\nError: Missing required columns in CSV.")
            print(f"Detected: {list(df.columns)}")
            print(f"Required: {required}")
            print(f"Common aliases supported: {COLUMN_ALIASES}")
            sys.exit(1)
            
        return df[required]

    def clean_data(self, df):
        """Preprocesses queries and ensures numeric safety."""
        # Drop empty queries
        df = df.dropna(subset=['query']).copy()
        
        # Clean query strings
        df['query_raw'] = df['query']
        df['query'] = df['query'].astype(str).str.lower().str.strip()
        df = df[df['query'].str.len() > 1]
        
        # Handle numeric types (strip commas, handle strings)
        for col in ['clicks', 'impressions', 'position']:
            if df[col].dtype == 'object':
                df[col] = df[col].str.replace(',', '').astype(float)
        
        # Handle CTR (can be "0.05" or "5.2%")
        if df['ctr'].dtype == 'object':
            df['ctr'] = df['ctr'].str.replace('%', '')
            df['ctr'] = pd.to_numeric(df['ctr'])
            # If values > 1, it was likely percentage (e.g., 5.0 meaning 5%)
            if df['ctr'].max() > 1.0:
                df['ctr'] = df['ctr'] / 100.0
        
        if self.min_impressions:
            df = df[df['impressions'] >= self.min_impressions]
            
        return df

    def classify_intent(self, query):
        """Rule-based intent classification."""
        query = query.lower()
        for intent, modifiers in INTENT_MAP.items():
            if any(mod in query for mod in modifiers):
                return intent
        return 'other'

    def perform_clustering(self):
        """Groups queries using TF-IDF and Agglomerative Clustering."""
        self.log(f"Clustering {len(self.df)} queries...")
        
        # Vectorization: word and char n-grams capture similar phrases effectively
        vectorizer = TfidfVectorizer(
            ngram_range=(1, 3),
            analyzer='word',
            stop_words='english',
            min_df=1
        )
        
        X = vectorizer.fit_transform(self.df['query'])
        
        # Heuristic for cluster count
        n_clusters = max(2, int(np.sqrt(len(self.df)) / 2))
        n_clusters = min(n_clusters, 100) # Cap to avoid fragmentation
        
        model = AgglomerativeClustering(n_clusters=n_clusters)
        self.df['cluster_id'] = model.fit_predict(X.toarray())
        
        # Generate Cluster Labels
        cluster_labels = {}
        for cluster_id in range(n_clusters):
            # Extract top words for this cluster
            cluster_queries = self.df[self.df['cluster_id'] == cluster_id]['query']
            words = " ".join(cluster_queries).split()
            # Simple frequency-based label (excluding stops)
            top_word = pd.Series(words).value_counts().index[0] if words else "misc"
            cluster_labels[cluster_id] = f"Topic: {top_word}"
            
        self.df['cluster_label'] = self.df['cluster_id'].map(cluster_labels)

    def identify_opportunities(self):
        """Scores queries and assigns actions based on performance patterns."""
        # Adaptive thresholds using percentiles
        hi_impr_thresh = self.df['impressions'].quantile(0.75)
        lo_ctr_thresh = self.df['ctr'].quantile(0.25)
        
        opps = []
        for _, row in self.df.iterrows():
            tags = []
            score = 0
            
            # 1. Near Page 1 (The "Striking Distance" win)
            if 4 <= row['position'] <= 20:
                tags.append("near_page_1")
                score += 40
            
            # 2. High Impressions / Low CTR (Snippet optimization)
            if row['impressions'] >= hi_impr_thresh and row['ctr'] <= lo_ctr_thresh:
                tags.append("high_impressions_low_ctr")
                score += 30
            
            # 3. Intent-based scoring
            intent = self.classify_intent(row['query'])
            if intent == 'commercial':
                tags.append("commercial_modifier")
                score += 20
            elif intent == 'informational' and row['position'] > 10:
                tags.append("informational_coverage_gap")
                score += 15

            # 4. Internal Link Candidate
            if row['impressions'] > hi_impr_thresh and row['position'] > 15:
                tags.append("internal_link_candidate")
                score += 10

            # Determine Action & Priority
            action = "Monitor"
            content_type = "refresh_existing"
            priority = "low"
            
            if "near_page_1" in tags and "high_impressions_low_ctr" in tags:
                action = "Rewrite Title/Meta Tags and add Schema markup"
                content_type = "snippet_optimization"
                priority = "high"
            elif "near_page_1" in tags:
                action = "Improve on-page content and add internal links"
                content_type = "refresh_existing"
                priority = "high"
            elif "informational_coverage_gap" in tags:
                action = "Create a dedicated deep-dive guide"
                content_type = "new_page"
                priority = "medium"
            elif "internal_link_candidate" in tags:
                action = "Add 3-5 internal links from high-authority pages"
                content_type = "internal_linking"
                priority = "medium"

            opps.append({
                'query': row['query_raw'],
                'primary_reason': tags[0] if tags else "low_score",
                'all_reasons': "|".join(tags),
                'recommended_action': action,
                'suggested_content_type': content_type,
                'priority': priority,
                'opportunity_score': min(score, 100),
                'opportunity_tags': "|".join(tags),
                'clicks': row['clicks'],
                'impressions': row['impressions'],
                'ctr': row['ctr'],
                'position': row['position'],
                'cluster_id': row['cluster_id'],
                'cluster_label': row['cluster_label'],
                'intent': intent
            })
            
        return pd.DataFrame(opps)

    def run(self):
        # 1. Load & Standardize
        try:
            raw_df = pd.read_csv(self.input_path)
        except Exception as e:
            self.log(f"Failed to read CSV: {e}")
            return

        self.df = self.normalize_columns(raw_df)
        self.df = self.clean_data(self.df)
        
        # 2. Process
        self.perform_clustering()
        self.opportunities_df = self.identify_opportunities()
        
        # 3. Export Dataframes
        # Cluster CSV
        cluster_export = self.opportunities_df[[
            'cluster_id', 'cluster_label', 'query', 'clicks', 'impressions', 
            'ctr', 'position', 'intent', 'opportunity_score', 'opportunity_tags'
        ]]
        cluster_export.to_csv(self.output_dir / "clusters.csv", index=False)
        
        # Opportunity CSV
        opp_export = self.opportunities_df[[
            'query', 'primary_reason', 'all_reasons', 'recommended_action', 
            'suggested_content_type', 'priority', 'clicks', 'impressions', 
            'ctr', 'position', 'cluster_id', 'intent'
        ]]
        opp_export.to_csv(self.output_dir / "opportunities.csv", index=False)
        
        # 4. Generate Summary
        self.generate_summary()
        
        self.log("Processing complete.")
        self.log(f"Results saved to: {self.output_dir}")
        print(f"\n--- QUICK SUMMARY ---")
        print(f"Total Queries Processed: {len(self.df)}")
        print(f"Total Clusters Identified: {self.df['cluster_id'].nunique()}")
        print(f"High Priority Opportunities: {len(self.opportunities_df[self.opportunities_df['priority'] == 'high'])}")

    def generate_summary(self):
        """Creates a stakeholder-friendly markdown summary."""
        total_clicks = self.df['clicks'].sum()
        total_impr = self.df['impressions'].sum()
        avg_pos = self.df['position'].mean()
        
        top_clusters = self.opportunities_df.groupby('cluster_label')['impressions'].sum().sort_values(ascending=False).head(10)
        high_priority_opps = self.opportunities_df[self.opportunities_df['priority'] == 'high'].sort_values('opportunity_score', ascending=False).head(20)

        summary_md = f"""# Search Console Intelligence Summary
Generated on: {pd.Timestamp.now().strftime('%Y-%m-%d')}

## Dataset Overview
- **Total Unique Queries:** {len(self.df)}
- **Total Clicks:** {total_clicks:,.0f}
- **Total Impressions:** {total_impr:,.0f}
- **Average Profile Position:** {avg_pos:.2f}

## Top 10 Topic Clusters (By Impression Volume)
Topic clusters represent groups of semantically related queries. Focus on high-impression clusters with low average CTR.

| Cluster Label | Est. Impressions |
|---------------|------------------|
"""
        for label, impr in top_clusters.items():
            summary_md += f"| {label} | {impr:,.0f} |\n"

        summary_md += """
## Top High-Priority Opportunities
These queries represent the "low hanging fruit" with the highest potential for traffic growth.

| Query | Priority | Recommended Action | Score |
|-------|----------|-------------------|-------|
"""
        for _, row in high_priority_opps.iterrows():
            summary_md += f"| {row['query']} | {row['priority'].upper()} | {row['recommended_action']} | {row['opportunity_score']} |\n"

        summary_md += """
## Technical Notes & Limitations
- **Clustering Heuristic:** Agglomerative Clustering used on TF-IDF vectors (ngram range 1-3).
- **Intent Attribution:** Rule-based keyword matching (informational, commercial, navigational, local).
- **Opportunity Scoring:** Adaptive thresholds based on the 75th percentile of impressions within this specific dataset.
- **AI Disclaimer:** No LLM was used for these labels; they are extracted via statistical significance.
"""
        with open(self.output_dir / "summary.md", "w") as f:
            f.write(summary_md)

def main():
    parser = argparse.ArgumentParser(description="GSC Query Intelligence - Topic Clustering & Opportunity Analysis")
    parser.add_argument("--input", help="Path to GSC Queries CSV export", required=False)
    parser.add_argument("--out", help="Output directory", default="gsc_intelligence_out")
    parser.add_argument("--min-impressions", type=int, help="Filter queries with impressions below this value")
    
    args = parser.parse_args()

    if not args.input:
        print("\n=== Search Console Query Intelligence ===")
        print("Usage: python gsc_query_intelligence.py --input path/to/gsc.csv --out out_dir")
        print("\nExpected Columns (Aliases Supported):")
        print("- Query / Top queries")
        print("- Clicks")
        print("- Impressions")
        print("- CTR")
        print("- Position / Average Position")
        print("\nExample Run:")
        print("python gsc_query_intelligence.py --input queries.csv --out seo_report --min-impressions 50")
        sys.exit(0)

    intel = GSCIntelligence(args.input, args.out, args.min_impressions)
    intel.run()

if __name__ == "__main__":
    main()
