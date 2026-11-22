#!/usr/bin/env python3
"""Google Trends direction bridge for problem-miner.ts.

Usage:
  python3 trends_bridge.py '["topic1","topic2"]'
    Prints a single JSON line: {"topic1":"rising","topic2":"stable",...}
    Direction = last-4-weeks avg vs previous-8-weeks avg (>20% = rising/falling).
  python3 trends_bridge.py rising '["topic1","topic2"]'
    Prints a single JSON line: {"topic1":["rising query",...],...}
    Rising related queries (pytrends related_queries, "rising" table,
    top 5 per topic) — what is heating up RIGHT NOW around a topic.
ANY failure (429, network, missing pytrends) -> all "unknown" / {}, exit 0.
Never fakes a direction or a query.
"""
import json
import sys


def direction(topics):
    result = {t: "unknown" for t in topics if isinstance(t, str)}
    topics = [t for t in topics if isinstance(t, str)][:5]
    if not topics:
        print(json.dumps(result))
        return
    try:
        from pytrends.request import TrendReq

        pytrends = TrendReq(hl="en-US", tz=360, timeout=(10, 25))
        pytrends.build_payload(topics, timeframe="today 12-m")
        df = pytrends.interest_over_time()
        for t in topics:
            try:
                series = df[t].tolist() if t in df.columns else []
                if len(series) < 12:
                    continue
                recent = sum(series[-4:]) / 4
                prev = sum(series[-12:-4]) / 8
                if prev <= 0:
                    continue
                change = (recent - prev) / prev
                result[t] = "rising" if change > 0.2 else "falling" if change < -0.2 else "stable"
            except Exception:
                continue
    except Exception:
        pass
    print(json.dumps(result))


def rising(topics):
    result = {t: [] for t in topics if isinstance(t, str)}
    topics = [t for t in topics if isinstance(t, str)][:5]
    if not topics:
        print(json.dumps(result))
        return
    try:
        from pytrends.request import TrendReq

        pytrends = TrendReq(hl="en-US", tz=360, timeout=(10, 25))
        pytrends.build_payload(topics, timeframe="today 3-m")
        related = pytrends.related_queries()
        for t in topics:
            try:
                rising_df = related.get(t, {}).get("rising")
                if rising_df is None or rising_df.empty:
                    continue
                queries = rising_df["query"].tolist()[:5]
                result[t] = [str(q) for q in queries if isinstance(q, str) and q.strip()]
            except Exception:
                continue
    except Exception:
        pass
    print(json.dumps(result))


def main() -> None:
    args = sys.argv[1:]
    mode = "direction"
    if args and args[0] == "rising":
        mode = "rising"
        args = args[1:]
    try:
        topics = json.loads(args[0] if args else "[]")
    except Exception:
        topics = []
    if mode == "rising":
        rising(topics)
    else:
        direction(topics)


if __name__ == "__main__":
    main()
