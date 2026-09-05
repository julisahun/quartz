package main

import (
	"flag"
	"testing"
)

func TestSplitArgsAcceptsFlagsInEitherOrder(t *testing.T) {
	cases := []struct {
		name      string
		args      []string
		wantPos   []string
		wantPurge bool
	}{
		{"flag after the name", []string{"maria", "-purge"}, []string{"maria"}, true},
		{"flag before the name", []string{"-purge", "maria"}, []string{"maria"}, true},
		{"no flag at all", []string{"maria"}, []string{"maria"}, false},
		{"two positionals and a flag", []string{"casa", "maria", "-purge"}, []string{"casa", "maria"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fs := flag.NewFlagSet("test", flag.ContinueOnError)
			purge := fs.Bool("purge", false, "")
			got := splitArgs(fs, c.args)
			if len(got) != len(c.wantPos) {
				t.Fatalf("positional = %v, want %v", got, c.wantPos)
			}
			for i := range got {
				if got[i] != c.wantPos[i] {
					t.Fatalf("positional = %v, want %v", got, c.wantPos)
				}
			}
			if *purge != c.wantPurge {
				t.Errorf("-purge = %v, want %v", *purge, c.wantPurge)
			}
		})
	}
}

func TestSplitArgsWithAValueFlag(t *testing.T) {
	fs := flag.NewFlagSet("test", flag.ContinueOnError)
	owner := fs.String("owner", "", "")
	got := splitArgs(fs, []string{"casa", "-owner", "juli"})
	if len(got) != 1 || got[0] != "casa" {
		t.Fatalf("positional = %v, want [casa]", got)
	}
	if *owner != "juli" {
		t.Errorf("-owner = %q, want juli", *owner)
	}
}
