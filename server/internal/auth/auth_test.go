package auth

import (
	"testing"
	"time"
)

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword("correct horse battery staple", hash)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword(correct) = %v, %v", ok, err)
	}
	ok, err = VerifyPassword("wrong", hash)
	if err != nil || ok {
		t.Fatalf("VerifyPassword(wrong) = %v, %v", ok, err)
	}
	// Two hashes of the same password must differ (per-hash salt).
	other, _ := HashPassword("correct horse battery staple")
	if other == hash {
		t.Error("hashes are not salted")
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	for _, bad := range []string{"", "plaintext", "$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA", "$argon2id$v=19$nope$AAAA$AAAA"} {
		if _, err := VerifyPassword("x", bad); err == nil {
			t.Errorf("VerifyPassword accepted malformed hash %q", bad)
		}
	}
}

func TestTokenHashing(t *testing.T) {
	token, hash, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || hash == token {
		t.Fatal("the stored hash must not be the token itself")
	}
	if HashToken(token) != hash {
		t.Fatal("HashToken is not stable")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !l.Allow("1.2.3.4") {
			t.Fatalf("attempt %d was blocked too early", i+1)
		}
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("fourth attempt should be blocked")
	}
	if !l.Allow("5.6.7.8") {
		t.Fatal("a different client must not be affected")
	}
	l.Reset("1.2.3.4")
	if !l.Allow("1.2.3.4") {
		t.Fatal("Reset did not clear the budget")
	}
}
