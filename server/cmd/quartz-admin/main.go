// Command quartz-admin manages accounts and vaults.
//
// There is no signup endpoint: accounts exist because someone with shell
// access to the server created them. Run it as the same user as the service
// (sigint on the Pi) so the directories it creates end up owned correctly.
//
//	quartz-admin user add maria
//	quartz-admin user passwd maria
//	quartz-admin user list
//	quartz-admin user remove maria [-purge]
//	quartz-admin vault create casa -owner juli -name "Casa"
//	quartz-admin vault share casa maria [-role member]
//	quartz-admin vault unshare casa maria
//	quartz-admin vault list
//	quartz-admin vault members casa
package main

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"quartz/internal/accounts"
	"quartz/internal/config"
	"quartz/internal/provision"

	"golang.org/x/term"
)

func main() {
	if len(os.Args) < 3 {
		usage()
		os.Exit(2)
	}
	cfg, err := config.Load()
	if err != nil {
		fail(err)
	}
	store, err := accounts.Open(cfg.AccountsDB())
	if err != nil {
		fail(fmt.Errorf("opening %s: %w", cfg.AccountsDB(), err))
	}
	defer store.Close()

	group, command, args := os.Args[1], os.Args[2], os.Args[3:]
	switch group {
	case "user":
		err = userCommand(store, cfg, command, args)
	case "vault":
		err = vaultCommand(store, cfg, command, args)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fail(err)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `quartz-admin — accounts and vaults

  user add <name>                       create an account and its private vault
  user passwd <name>                    change a password
  user list                             who exists
  user remove <name> [-purge]           remove an account (-purge deletes its notes)

  vault create <id> -owner <user> [-name "Display name"]
  vault share <id> <user> [-role member|owner]
  vault unshare <id> <user>
  vault list
  vault members <id>`)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func userCommand(store *accounts.Store, cfg config.Config, command string, args []string) error {
	switch command {
	case "add":
		if len(args) < 1 {
			return errors.New("usage: quartz-admin user add <name>")
		}
		name := args[0]
		password, err := readNewPassword()
		if err != nil {
			return err
		}
		if err := provision.User(store, cfg, name, password); err != nil {
			return err
		}
		fmt.Printf("created %s with a private vault at %s/%s\n", name, cfg.VaultsDir(), name)
		return nil

	case "passwd":
		if len(args) < 1 {
			return errors.New("usage: quartz-admin user passwd <name>")
		}
		password, err := readNewPassword()
		if err != nil {
			return err
		}
		if err := store.SetPassword(args[0], password); err != nil {
			return err
		}
		fmt.Printf("password changed for %s (existing sessions stay valid)\n", args[0])
		return nil

	case "list":
		users, err := store.ListUsers()
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "USER\tCREATED\tVAULTS")
		for _, u := range users {
			vaults, err := store.VaultsFor(u.Name)
			if err != nil {
				return err
			}
			names := make([]string, 0, len(vaults))
			for _, v := range vaults {
				names = append(names, fmt.Sprintf("%s(%s)", v.ID, v.Role))
			}
			fmt.Fprintf(w, "%s\t%s\t%s\n", u.Name, u.Created.Format("2006-01-02"), strings.Join(names, " "))
		}
		return w.Flush()

	case "remove":
		fs := flag.NewFlagSet("remove", flag.ExitOnError)
		purge := fs.Bool("purge", false, "also delete the user's private vault and its notes")
		fs.Parse(args)
		if fs.NArg() < 1 {
			return errors.New("usage: quartz-admin user remove <name> [-purge]")
		}
		name := fs.Arg(0)
		if err := store.DeleteUser(name); err != nil {
			return err
		}
		fmt.Printf("removed %s\n", name)
		if *purge {
			if err := provision.DeleteVaultData(store, cfg, name); err != nil {
				fmt.Fprintf(os.Stderr, "could not delete the vault data: %v\n", err)
			} else {
				fmt.Printf("deleted the notes in %s's private vault\n", name)
			}
		} else {
			fmt.Printf("their notes are still on disk; remove them with -purge\n")
		}
		return nil
	}
	return fmt.Errorf("unknown user command %q", command)
}

func vaultCommand(store *accounts.Store, cfg config.Config, command string, args []string) error {
	switch command {
	case "create":
		fs := flag.NewFlagSet("create", flag.ExitOnError)
		owner := fs.String("owner", "", "the account that owns it")
		name := fs.String("name", "", "display name (defaults to the id)")
		fs.Parse(args)
		if fs.NArg() < 1 || *owner == "" {
			return errors.New(`usage: quartz-admin vault create <id> -owner <user> [-name "Display name"]`)
		}
		id := fs.Arg(0)
		if err := provision.SharedVault(store, cfg, id, *name, *owner); err != nil {
			return err
		}
		fmt.Printf("created shared vault %s owned by %s\n", id, *owner)
		return nil

	case "share":
		fs := flag.NewFlagSet("share", flag.ExitOnError)
		role := fs.String("role", "member", "member or owner")
		fs.Parse(args)
		if fs.NArg() < 2 {
			return errors.New("usage: quartz-admin vault share <id> <user> [-role member|owner]")
		}
		if *role != string(accounts.Member) && *role != string(accounts.Owner) {
			return errors.New("role must be member or owner")
		}
		if err := store.AddMember(fs.Arg(0), fs.Arg(1), accounts.Role(*role)); err != nil {
			return err
		}
		fmt.Printf("%s can now open %s as %s\n", fs.Arg(1), fs.Arg(0), *role)
		return nil

	case "unshare":
		if len(args) < 2 {
			return errors.New("usage: quartz-admin vault unshare <id> <user>")
		}
		if err := store.RemoveMember(args[0], args[1]); err != nil {
			return err
		}
		fmt.Printf("%s can no longer open %s\n", args[1], args[0])
		return nil

	case "list":
		vaults, err := store.AllVaults()
		if err != nil {
			return err
		}
		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "VAULT\tKIND\tOWNER\tMEMBERS\tROOT")
		for _, v := range vaults {
			members, err := store.Members(v.ID)
			if err != nil {
				return err
			}
			names := make([]string, 0, len(members))
			for user := range members {
				names = append(names, user)
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", v.ID, v.Kind, v.Owner, strings.Join(names, " "), v.Root)
		}
		return w.Flush()

	case "members":
		if len(args) < 1 {
			return errors.New("usage: quartz-admin vault members <id>")
		}
		members, err := store.Members(args[0])
		if err != nil {
			return err
		}
		for user, role := range members {
			fmt.Printf("%s\t%s\n", user, role)
		}
		return nil
	}
	return fmt.Errorf("unknown vault command %q", command)
}

func readNewPassword() (string, error) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		// Non-interactive: read one line, so scripts can pipe a password in.
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return "", err
		}
		return strings.TrimRight(line, "\r\n"), nil
	}
	fmt.Fprint(os.Stderr, "password: ")
	first, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	fmt.Fprint(os.Stderr, "again: ")
	second, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	if string(first) != string(second) {
		return "", errors.New("passwords did not match")
	}
	if len(first) < 8 {
		return "", errors.New("use at least 8 characters")
	}
	return string(first), nil
}
