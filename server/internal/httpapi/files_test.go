package httpapi

import "testing"

func TestUnquoteETag(t *testing.T) {
	const hash = "0432236fc22fcf3678c45153474b53fa95d610d307abf82c92f1c96465c4e7ca"
	cases := map[string]string{
		hash:               hash,
		`"` + hash + `"`:   hash,
		`W/"` + hash + `"`: hash,
		// What a client sends after a compressing proxy weakened the tag and
		// the client re-quoted it. This is the shape that caused real conflict
		// copies against the live server on 2026-09-05.
		`"W/` + hash + `"`:   hash,
		` "` + hash + `" `:   hash,
		`W/W/"` + hash + `"`: hash,
		"":                   "",
		`""`:                 "",
	}
	for input, want := range cases {
		if got := unquoteETag(input); got != want {
			t.Errorf("unquoteETag(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestETagMatches(t *testing.T) {
	const hash = "abc123"
	for _, header := range []string{`"abc123"`, `W/"abc123"`, `"W/abc123"`, `"other", "abc123"`} {
		if !etagMatches(header, hash) {
			t.Errorf("etagMatches(%q, %q) = false, want true", header, hash)
		}
	}
	if etagMatches(`"nope"`, hash) {
		t.Error("a different tag matched")
	}
}
