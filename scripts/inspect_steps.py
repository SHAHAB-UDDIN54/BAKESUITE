import json

log_path = r"C:\Users\k  H  a  N\.gemini\antigravity-ide\brain\1ba73eae-8d4a-42b8-9fd9-1c1cec8216e8\.system_generated\logs\transcript_full.jsonl"

with open(log_path, "r", encoding="utf-8") as f:
    for i, line in enumerate(f):
        if i in (121, 122, 123):
            item = json.loads(line)
            print(f"Step {i}: keys={item.keys()}")
            if "tool_calls" in item:
                print(f"  tool_calls count: {len(item['tool_calls'])}")
                for tc in item['tool_calls']:
                    print(f"    tool: {tc.get('name')}, args keys: {tc.get('args', {}).keys()}")
                    if 'CodeContent' in tc.get('args', {}):
                        cc = tc['args']['CodeContent']
                        print(f"    CodeContent len: {len(cc)}")
                        if "TransactionNo" in cc:
                            print(f"    CodeContent has TransactionNo! lines: {len(cc.splitlines())}")

