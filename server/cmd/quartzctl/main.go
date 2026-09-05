// Command quartzctl syncs a local folder against a quartz server.
//
// It is the milestone-1 client: enough to prove the sync algorithm end to end
// with no UI written, and useful afterwards as a headless mirror.
//
//	quartzctl login  -server https://notes.sigint-pm.uk -user juli -dir ./vault
//	quartzctl sync   -dir ./vault
//	quartzctl watch  -dir ./vault -interval 15s
//	quartzctl status -dir ./vault
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "login":
		err = cmdLogin(os.Args[2:])
	case "sync":
		err = cmdSync(os.Args[2:])
	case "watch":
		err = cmdWatch(os.Args[2:])
	case "status":
		err = cmdStatus(os.Args[2:])
	case "-h", "--help", "help":
		usage()
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `quartzctl — sync a folder with a quartz server

  login   -server URL -user NAME [-device NAME] [-dir DIR]
  sync    [-dir DIR]
  watch   [-dir DIR] [-interval 15s]
  status  [-dir DIR]`)
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "cli"
	}
	return strings.Split(h, ".")[0]
}

func cmdLogin(args []string) error {
	fs := flag.NewFlagSet("login", flag.ExitOnError)
	server := fs.String("server", "", "server base URL")
	user := fs.String("user", "juli", "user name")
	device := fs.String("device", hostname(), "device name, used in conflict copies")
	dir := fs.String("dir", ".", "local folder to sync")
	fs.Parse(args)

	if *server == "" {
		return fmt.Errorf("-server is required")
	}
	st, err := loadState(*dir)
	if err != nil {
		return err
	}
	st.Server, st.User, st.Device = *server, *user, *device

	fmt.Fprint(os.Stderr, "password: ")
	var password string
	if term.IsTerminal(int(os.Stdin.Fd())) {
		raw, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if err != nil {
			return err
		}
		password = string(raw)
	} else {
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		password = strings.TrimRight(line, "\r\n")
	}

	cookie, err := newClient(st).login(*user, password)
	if err != nil {
		return err
	}
	st.Cookie = cookie
	if err := st.save(); err != nil {
		return err
	}
	fmt.Printf("logged in to %s as %s (device %s)\n", *server, *user, *device)
	return nil
}

func openSyncer(dir string) (*syncer, error) {
	st, err := loadState(dir)
	if err != nil {
		return nil, err
	}
	if st.Server == "" || st.Cookie == "" {
		return nil, fmt.Errorf("no session in %s — run `quartzctl login` first", dir)
	}
	v, err := localVault(dir)
	if err != nil {
		return nil, err
	}
	return &syncer{c: newClient(st), st: st, dir: dir, v: v}, nil
}

func cmdSync(args []string) error {
	fs := flag.NewFlagSet("sync", flag.ExitOnError)
	dir := fs.String("dir", ".", "local folder to sync")
	fs.Parse(args)

	s, err := openSyncer(*dir)
	if err != nil {
		return err
	}
	stats, err := s.run()
	if err != nil {
		return err
	}
	fmt.Printf("pulled %d, pushed %d, deleted %d, conflicts %d (cursor %d)\n",
		stats.Pulled, stats.Pushed, stats.Deleted, stats.Conflicts, s.st.Cursor)
	return nil
}

func cmdWatch(args []string) error {
	fs := flag.NewFlagSet("watch", flag.ExitOnError)
	dir := fs.String("dir", ".", "local folder to sync")
	interval := fs.Duration("interval", 15*time.Second, "poll interval")
	fs.Parse(args)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	for {
		s, err := openSyncer(*dir)
		if err != nil {
			return err
		}
		stats, err := s.run()
		switch {
		case err != nil:
			// Never fatal: the network comes and goes, and unsent work stays
			// on disk until it can be pushed.
			fmt.Fprintln(os.Stderr, "sync failed:", err)
		case stats.Pulled+stats.Pushed+stats.Deleted+stats.Conflicts > 0:
			fmt.Printf("%s  pulled %d, pushed %d, deleted %d, conflicts %d\n",
				time.Now().Format("15:04:05"), stats.Pulled, stats.Pushed, stats.Deleted, stats.Conflicts)
		}
		select {
		case <-stop:
			fmt.Fprintln(os.Stderr, "stopped")
			return nil
		case <-time.After(*interval):
		}
	}
}

func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	dir := fs.String("dir", ".", "local folder to sync")
	fs.Parse(args)

	st, err := loadState(*dir)
	if err != nil {
		return err
	}
	v, err := localVault(*dir)
	if err != nil {
		return err
	}
	files, err := v.Scan()
	if err != nil {
		return err
	}
	fmt.Printf("server   %s\nuser     %s\ndevice   %s\ncursor   %d\nfiles    %d local, %d tracked\n",
		st.Server, st.User, st.Device, st.Cursor, len(files), len(st.Files))

	dirty := 0
	for _, f := range files {
		if rec, ok := st.Files[f.Path]; !ok || rec.BaseHash != f.Hash {
			dirty++
			fmt.Printf("  modified  %s\n", f.Path)
		}
	}
	onDisk := map[string]bool{}
	for _, f := range files {
		onDisk[f.Path] = true
	}
	for p := range st.Files {
		if !onDisk[p] {
			dirty++
			fmt.Printf("  deleted   %s\n", p)
		}
	}
	if dirty == 0 {
		fmt.Println("  clean")
	}
	return nil
}
