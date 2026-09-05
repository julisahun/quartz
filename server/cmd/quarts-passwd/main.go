// Command quarts-passwd prints an argon2id hash for QUARTS_PASSWORD_HASH.
//
//	quarts-passwd            # prompts, hidden input
//	echo -n hunter2 | quarts-passwd -stdin
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"quarts/internal/auth"

	"golang.org/x/term"
)

func main() {
	fromStdin := len(os.Args) > 1 && os.Args[1] == "-stdin"

	var password string
	if fromStdin {
		data, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && data == "" {
			fmt.Fprintln(os.Stderr, "could not read a password from stdin")
			os.Exit(1)
		}
		password = strings.TrimRight(data, "\r\n")
	} else {
		fmt.Fprint(os.Stderr, "password: ")
		raw, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			fmt.Fprintln(os.Stderr, "could not read the password:", err)
			os.Exit(1)
		}
		password = string(raw)

		fmt.Fprint(os.Stderr, "again: ")
		again, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil || string(again) != password {
			fmt.Fprintln(os.Stderr, "passwords did not match")
			os.Exit(1)
		}
	}
	if len(password) < 8 {
		fmt.Fprintln(os.Stderr, "use at least 8 characters")
		os.Exit(1)
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		fmt.Fprintln(os.Stderr, "hashing failed:", err)
		os.Exit(1)
	}
	fmt.Println(hash)
}
