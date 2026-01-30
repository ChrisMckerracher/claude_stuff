# Task 4a.2: Python HTTP Extractor

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement HTTP call extraction for Python (requests, httpx, aiohttp).

## File

`rag/extractors/languages/python.py`

## Implementation

```python
import tree_sitter
import tree_sitter_python
from rag.extractors.base import ServiceCall, LanguageExtractor, PatternMatcher, Confidence
from rag.extractors.patterns import extract_service_from_url, determine_confidence, is_in_comment_or_docstring

class PythonHttpPattern(PatternMatcher):
    """Matches Python HTTP client calls.

    Detects:
    - requests.get/post/put/delete/patch
    - httpx.get/post (sync and async)
    - aiohttp.ClientSession().get/post

    TEST VECTORS - Must Match:
    --------------------------
    requests.get("http://user-service/api/users")
    → ServiceCall(target="user-service", method="GET", confidence=HIGH)

    httpx.post(f"http://{SERVICE}/users", json=data)
    → ServiceCall(target=<SERVICE>, method="POST", confidence=MEDIUM)

    async with aiohttp.ClientSession() as s:
        await s.get("http://user-service/api")
    → ServiceCall(target="user-service", method="GET", confidence=HIGH)

    Must NOT Match:
    ---------------
    requests.get(local_file_path)      # No http://
    urllib.parse.urlparse(url)         # Parsing, not calling
    "http://example.com" in docstring  # String in docs
    """

    HTTP_METHODS = {'get', 'post', 'put', 'delete', 'patch', 'head', 'options'}
    HTTP_CLIENTS = {'requests', 'httpx', 'aiohttp', 'urllib', 'http'}

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        """Extract HTTP calls from AST node."""
        if node.type != 'call':
            return []

        # Skip if in comment/docstring
        if is_in_comment_or_docstring(node, source):
            return []

        # Get the function being called
        func = node.child_by_field_name('function')
        if not func:
            return []

        # Handle attribute calls like requests.get()
        if func.type == 'attribute':
            return self._match_attribute_call(node, func, source)

        return []

    def _match_attribute_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match calls like requests.get(), httpx.post()."""
        # Get object.method
        obj = func_node.child_by_field_name('object')
        attr = func_node.child_by_field_name('attribute')

        if not obj or not attr:
            return []

        obj_text = source[obj.start_byte:obj.end_byte].decode('utf-8', errors='replace')
        method_name = source[attr.start_byte:attr.end_byte].decode('utf-8', errors='replace')

        # Check if this is an HTTP client call
        if method_name.lower() not in self.HTTP_METHODS:
            return []

        # Check if object is an HTTP client
        if not self._is_http_client(obj_text, obj):
            return []

        # Extract URL from first argument
        args = call_node.child_by_field_name('arguments')
        if not args or not args.children:
            return []

        url_info = self._extract_url_from_args(args, source)
        if not url_info:
            return []

        url_str, confidence = url_info
        service, path = extract_service_from_url(url_str)

        if not service:
            return []

        return [ServiceCall(
            source_file="",  # Filled in by caller
            target_service=service,
            call_type="http",
            line_number=call_node.start_point[0] + 1,
            confidence=confidence,
            method=method_name.upper(),
            url_path=path,
            target_host=service,
        )]

    def _is_http_client(self, obj_text: str, obj_node: tree_sitter.Node) -> bool:
        """Check if object is an HTTP client."""
        # Direct client: requests, httpx
        if obj_text.lower() in self.HTTP_CLIENTS:
            return True

        # Session/client instance: session.get(), client.get()
        if obj_text.lower() in ('session', 'client', 's', 'c', 'http_client'):
            return True

        # AsyncClient, aiohttp session
        if 'client' in obj_text.lower() or 'session' in obj_text.lower():
            return True

        return False

    def _extract_url_from_args(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
    ) -> tuple[str, float] | None:
        """Extract URL string from call arguments."""
        for child in args_node.children:
            if child.type == 'string':
                url = source[child.start_byte:child.end_byte].decode('utf-8', errors='replace')
                url = url.strip('"\'')
                if url.startswith(('http://', 'https://')):
                    return url, Confidence.HIGH

            elif child.type == 'formatted_string':
                # f-string - extract what we can
                text = source[child.start_byte:child.end_byte].decode('utf-8', errors='replace')
                if 'http://' in text or 'https://' in text:
                    return text, Confidence.MEDIUM

            elif child.type == 'identifier':
                # Variable - low confidence
                return f"http://{child.text.decode()}", Confidence.LOW

        return None


class PythonExtractor(LanguageExtractor):
    """Extracts service calls from Python source code."""

    language = "python"

    def __init__(self):
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter_python.language()
        self._patterns = [
            PythonHttpPattern(),
            # PythonGrpcPattern(),      # Added in task 4a.3
            # PythonQueuePattern(),     # Added in task 4a.3
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from Python source."""
        tree = self._parser.parse(source)
        calls = []

        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))

        return calls

    def _walk_calls(self, node: tree_sitter.Node):
        """Yield all call nodes in AST."""
        if node.type == 'call':
            yield node
        for child in node.children:
            yield from self._walk_calls(child)

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
```

## Acceptance Tests

```python
def test_extracts_requests_get_literal():
    code = b'requests.get("http://user-service/api/users")'
    calls = PythonExtractor().extract(code)
    assert len(calls) == 1
    assert calls[0].target_service == "user-service"
    assert calls[0].url_path == "/api/users"
    assert calls[0].method == "GET"
    assert calls[0].confidence >= Confidence.HIGH

def test_extracts_httpx_post():
    code = b'httpx.post("http://billing-api/charge", json={"amount": 100})'
    calls = PythonExtractor().extract(code)
    assert len(calls) == 1
    assert calls[0].method == "POST"
    assert calls[0].target_service == "billing-api"

def test_extracts_fstring_medium_confidence():
    code = b'requests.get(f"http://{SERVICE_HOST}/api/users")'
    calls = PythonExtractor().extract(code)
    assert len(calls) == 1
    assert calls[0].confidence == Confidence.MEDIUM

def test_ignores_docstring_urls():
    code = b'''
def fetch():
    """Example: http://user-service/api"""
    pass
'''
    calls = PythonExtractor().extract(code)
    assert len(calls) == 0

def test_ignores_comment_urls():
    code = b'# TODO: call http://user-service/api\npass'
    calls = PythonExtractor().extract(code)
    assert len(calls) == 0

def test_extracts_multiple_calls():
    code = b'''
requests.get("http://user-service/users")
requests.post("http://billing-api/charge")
'''
    calls = PythonExtractor().extract(code)
    assert len(calls) == 2
```

## Acceptance Criteria

- [ ] Detects requests.get/post/put/delete/patch
- [ ] Detects httpx sync and async calls
- [ ] Detects aiohttp session calls
- [ ] Confidence levels correctly assigned
- [ ] URLs in docstrings ignored
- [ ] URLs in comments ignored
- [ ] Multiple calls per file detected

## Estimated Time

45 minutes
