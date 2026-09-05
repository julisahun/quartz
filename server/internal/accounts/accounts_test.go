package accounts

import (
	"path/filepath"
	"testing"
	"time"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "accounts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestUsersAndPasswords(t *testing.T) {
	s := openTestStore(t)
	if err := s.CreateUser("juli", "correct horse battery"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser("juli", "another"); err != ErrUserExists {
		t.Fatalf("duplicate user = %v, want ErrUserExists", err)
	}

	ok, err := s.Verify("juli", "correct horse battery")
	if err != nil || !ok {
		t.Fatalf("Verify(correct) = %v, %v", ok, err)
	}
	if ok, _ := s.Verify("juli", "wrong"); ok {
		t.Error("wrong password accepted")
	}
	if ok, err := s.Verify("nobody", "anything"); ok || err != nil {
		t.Errorf("Verify(unknown user) = %v, %v", ok, err)
	}

	if err := s.SetPassword("juli", "a new password"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Verify("juli", "a new password"); !ok {
		t.Error("password change did not take")
	}
	if ok, _ := s.Verify("juli", "correct horse battery"); ok {
		t.Error("the old password still works")
	}
	if err := s.SetPassword("nobody", "x"); err != ErrNoSuchUser {
		t.Errorf("SetPassword(unknown) = %v", err)
	}
}

func TestUnknownUserCostsTheSameAsAWrongPassword(t *testing.T) {
	// Otherwise the response time tells an attacker which names exist.
	s := openTestStore(t)
	if err := s.CreateUser("juli", "a real password"); err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	s.Verify("juli", "wrong password")
	wrongPassword := time.Since(start)

	start = time.Now()
	s.Verify("does-not-exist", "wrong password")
	unknownUser := time.Since(start)

	ratio := float64(unknownUser) / float64(wrongPassword)
	if ratio < 0.2 || ratio > 5 {
		t.Errorf("unknown user took %v against %v for a wrong password", unknownUser, wrongPassword)
	}
}

func TestNameValidation(t *testing.T) {
	s := openTestStore(t)
	for _, bad := range []string{"", "..", ".", "with space", "with/slash", "../escape", "a\x00b"} {
		if err := s.CreateUser(bad, "password"); err != ErrBadName {
			t.Errorf("CreateUser(%q) = %v, want ErrBadName", bad, err)
		}
	}
	for _, good := range []string{"juli", "maria.lopez", "a-b_c", "user2"} {
		if err := s.CreateUser(good, "password"); err != nil {
			t.Errorf("CreateUser(%q) = %v", good, err)
		}
	}
}

func TestVaultsAndAccess(t *testing.T) {
	s := openTestStore(t)
	for _, name := range []string{"juli", "maria", "outsider"} {
		if err := s.CreateUser(name, "password"); err != nil {
			t.Fatal(err)
		}
	}

	private := Vault{ID: "juli", Name: "juli", Kind: Private, Root: "/srv/quartz/vaults/juli", Owner: "juli"}
	if err := s.CreateVault(private); err != nil {
		t.Fatal(err)
	}
	shared := Vault{ID: "casa", Name: "Casa", Kind: Shared, Root: "/srv/quartz/vaults/casa", Owner: "juli"}
	if err := s.CreateVault(shared); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateVault(shared); err != ErrVaultExists {
		t.Fatalf("duplicate vault = %v", err)
	}

	// Creating a vault makes its owner a member.
	if role, err := s.Access("juli", "juli"); err != nil || role != Owner {
		t.Fatalf("owner access = %v, %v", role, err)
	}

	// Nobody else can reach it until they are added.
	if _, err := s.Access("maria", "juli"); err != ErrNotAMember {
		t.Fatalf("maria's access to juli's private vault = %v, want ErrNotAMember", err)
	}
	if err := s.AddMember("casa", "maria", Member); err != nil {
		t.Fatal(err)
	}
	if role, err := s.Access("maria", "casa"); err != nil || role != Member {
		t.Fatalf("maria's access to the shared vault = %v, %v", role, err)
	}
	if _, err := s.Access("outsider", "casa"); err != ErrNotAMember {
		t.Errorf("outsider reached the shared vault: %v", err)
	}

	// Membership decides what a user is shown.
	julisVaults, err := s.VaultsFor("juli")
	if err != nil || len(julisVaults) != 2 {
		t.Fatalf("juli sees %+v, %v", julisVaults, err)
	}
	mariasVaults, err := s.VaultsFor("maria")
	if err != nil || len(mariasVaults) != 1 || mariasVaults[0].ID != "casa" {
		t.Fatalf("maria sees %+v, %v", mariasVaults, err)
	}
	if outsiders, _ := s.VaultsFor("outsider"); len(outsiders) != 0 {
		t.Errorf("outsider sees %+v", outsiders)
	}

	// Membership can be taken away, but an owner cannot be removed.
	if err := s.RemoveMember("casa", "maria"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Access("maria", "casa"); err != ErrNotAMember {
		t.Errorf("removal did not take: %v", err)
	}
	if err := s.RemoveMember("casa", "juli"); err != ErrLastOwner {
		t.Errorf("removing the owner = %v, want ErrLastOwner", err)
	}
	if err := s.AddMember("casa", "ghost", Member); err != ErrNoSuchUser {
		t.Errorf("adding an unknown user = %v", err)
	}
	if err := s.AddMember("no-vault", "maria", Member); err != ErrNoSuchVault {
		t.Errorf("adding to an unknown vault = %v", err)
	}
}

func TestDeletingAUserRemovesTheirAccess(t *testing.T) {
	s := openTestStore(t)
	if err := s.CreateUser("juli", "password"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateUser("maria", "password"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateVault(Vault{ID: "casa", Name: "Casa", Kind: Shared, Root: "/tmp/casa", Owner: "juli"}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddMember("casa", "maria", Member); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession("hash-maria", "maria", "phone", time.Hour); err != nil {
		t.Fatal(err)
	}

	if err := s.DeleteUser("maria"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Access("maria", "casa"); err != ErrNotAMember {
		t.Errorf("a deleted user kept access: %v", err)
	}
	if _, ok, _ := s.LookupSession("hash-maria"); ok {
		t.Error("a deleted user's session still resolves")
	}
	if err := s.DeleteUser("maria"); err != ErrNoSuchUser {
		t.Errorf("deleting twice = %v", err)
	}
}

func TestSessionsBelongToAUser(t *testing.T) {
	s := openTestStore(t)
	if err := s.CreateUser("juli", "password"); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateSession("hash1", "juli", "macbook", time.Hour); err != nil {
		t.Fatal(err)
	}
	session, ok, err := s.LookupSession("hash1")
	if err != nil || !ok || session.User != "juli" || session.Device != "macbook" {
		t.Fatalf("LookupSession = %+v, %v, %v", session, ok, err)
	}
	if _, ok, _ := s.LookupSession("nope"); ok {
		t.Error("unknown token accepted")
	}

	if err := s.CreateSession("expired", "juli", "old", -time.Hour); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.LookupSession("expired"); ok {
		t.Error("expired session accepted")
	}
	if err := s.PurgeExpiredSessions(); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := s.LookupSession("hash1"); !ok {
		t.Error("purge removed a live session")
	}
}
