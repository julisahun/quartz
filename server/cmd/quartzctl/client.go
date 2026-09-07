package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"quartz/internal/index"
	"quartz/internal/vault"
)

type client struct {
	base   string
	cookie string
	device string
	vault  string
	http   *http.Client
}

func newClient(st *state) *client {
	return &client{
		base:   strings.TrimRight(st.Server, "/"),
		cookie: st.Cookie,
		device: st.Device,
		vault:  st.Vault,
		http:   &http.Client{Timeout: 2 * time.Minute},
	}
}

// vaultPath builds a path under the vault this client is bound to. Every
// content endpoint lives under one, so there is no way to ask for "the vault"
// without saying which.
func (c *client) vaultPath(suffix string) string {
	return "/api/v/" + url.PathEscape(c.vault) + suffix
}

type apiError struct {
	Status int
	Code   string
	Msg    string
	ETag   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("%s (HTTP %d%s)", e.Msg, e.Status, func() string {
		if e.Code == "" {
			return ""
		}
		return " " + e.Code
	}())
}

func (c *client) do(method, path string, body io.Reader, headers map[string]string) (*http.Response, error) {
	req, err := http.NewRequest(method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	if c.cookie != "" {
		req.Header.Set("Cookie", "quartz_session="+c.cookie)
	}
	req.Header.Set("X-Quartz-Device", c.device)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		var e struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		_ = json.Unmarshal(raw, &e)
		msg := e.Error
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		return nil, &apiError{Status: resp.StatusCode, Code: e.Code, Msg: msg, ETag: resp.Header.Get("ETag")}
	}
	return resp, nil
}

type vaultInfo struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Owner string `json:"owner"`
	Role  string `json:"role"`
}

// login returns the session cookie and the vaults this account may open.
func (c *client) login(user, password string) (string, []vaultInfo, error) {
	payload, _ := json.Marshal(map[string]string{"user": user, "password": password, "device": c.device})
	resp, err := c.do(http.MethodPost, "/auth/login", bytes.NewReader(payload),
		map[string]string{"Content-Type": "application/json"})
	if err != nil {
		return "", nil, err
	}
	defer resp.Body.Close()

	var body struct {
		Vaults []vaultInfo `json:"vaults"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", nil, err
	}
	for _, ck := range resp.Cookies() {
		if ck.Name == "quartz_session" {
			return ck.Value, body.Vaults, nil
		}
	}
	return "", nil, fmt.Errorf("the server did not return a session cookie")
}

func (c *client) vaults() ([]vaultInfo, error) {
	resp, err := c.do(http.MethodGet, "/api/vaults", nil, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var body struct {
		Vaults []vaultInfo `json:"vaults"`
	}
	return body.Vaults, json.NewDecoder(resp.Body).Decode(&body)
}

type snapshot struct {
	Head  int64            `json:"head"`
	Epoch string           `json:"epoch"`
	Files []vault.FileMeta `json:"files"`
}

func (c *client) snapshot() (snapshot, error) {
	resp, err := c.do(http.MethodGet, c.vaultPath("/snapshot"), nil, nil)
	if err != nil {
		return snapshot{}, err
	}
	defer resp.Body.Close()
	var s snapshot
	return s, json.NewDecoder(resp.Body).Decode(&s)
}

type changePage struct {
	Head    int64          `json:"head"`
	Epoch   string         `json:"epoch"`
	Changes []index.Change `json:"changes"`
	More    bool           `json:"more"`
}

func (c *client) changes(since int64) (changePage, error) {
	resp, err := c.do(http.MethodGet, fmt.Sprintf("%s?since=%d", c.vaultPath("/changes"), since), nil, nil)
	if err != nil {
		return changePage{}, err
	}
	defer resp.Body.Close()
	var p changePage
	return p, json.NewDecoder(resp.Body).Decode(&p)
}

func (c *client) getFile(path string) ([]byte, string, error) {
	resp, err := c.do(http.MethodGet, c.vaultPath("/file?path=")+url.QueryEscape(path), nil, nil)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	return data, strings.Trim(resp.Header.Get("ETag"), `"`), nil
}

// putFile writes a file under a precondition. baseHash == "" means "create".
func (c *client) putFile(path string, data []byte, baseHash string) (vault.FileMeta, error) {
	headers := map[string]string{"Content-Type": "application/octet-stream"}
	if baseHash == "" {
		headers["If-None-Match"] = "*"
	} else {
		headers["If-Match"] = `"` + baseHash + `"`
	}
	resp, err := c.do(http.MethodPut, c.vaultPath("/file?path=")+url.QueryEscape(path), bytes.NewReader(data), headers)
	if err != nil {
		return vault.FileMeta{}, err
	}
	defer resp.Body.Close()
	var meta vault.FileMeta
	return meta, json.NewDecoder(resp.Body).Decode(&meta)
}

func (c *client) deleteFile(path, baseHash string) error {
	resp, err := c.do(http.MethodDelete, c.vaultPath("/file?path=")+url.QueryEscape(path), nil,
		map[string]string{"If-Match": `"` + baseHash + `"`})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)
	return nil
}
