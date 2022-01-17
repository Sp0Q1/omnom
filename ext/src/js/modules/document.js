import { downloadFile } from './file-download';
import { sanitizeCSS } from './sanitize';

class Document {
    constructor(html, url, doctype, htmlAttributes) {
        this.url = url;
        this.doctype = doctype;
        this.dom = document.createElement('html');
        this.iframes = [];
        this.styleIndex = 0;
        this.styleNodes = new Map();
        this.favicon = null;
        this.dom.innerHTML = html;
        for (const k in htmlAttributes) {
            this.dom.setAttribute(k, htmlAttributes[k]);
        }
        this.nodeTransformFunctons = new Map([
            ['SCRIPT', (node) => node.remove()],
            ['LINK', this.transformLink],
            ['STYLE', this.transformStyle],
            ['IMG', this.transfromImg],
            ['IFRAME', this.transfromIframe],
            ['BASE', this.setUrl]
        ]);
    }

    absoluteUrl(url) {
        if (!url) {
            return this.url;
        }
        return new URL(url, this.url).href;
    }

    getDomAsText() {
        return `${this.doctype}${this.dom.outerHTML}`;
    }

    async transformDom() {
        await this.walkDOM(this.dom);
        await this.setStyleNodes();
        let favicon = document.getElementById('favicon')?.value;
        if (!favicon) {
            this.favicon = await downloadFile(this.absoluteUrl('/favicon.ico'));
            if (this.favicon) {
                const faviconElement = document.createElement('link');
                faviconElement.setAttribute('rel', 'icon');
                faviconElement.setAttribute('href', this.favicon);
                document.getElementsByTagName('head')[0].appendChild(faviconElement);
            }
        }
    }

    async walkDOM(node) {
        await this.transformNode(node);
        const children = [...node.childNodes];
        return Promise.allSettled(children.map(async (node) => {
            await this.walkDOM(node);
        }));
    }

    async setStyleNodes() {
        const sortedStyles = new Map([...this.styleNodes.entries()].sort((e1, e2) => e1[0] - e2[0]));
        let parent;
        if (this.dom.getElementsByTagName("head")) {
            parent = this.dom.getElementsByTagName("head")[0];
        } else {
            parent = this.dom.documentElement;
        }
        sortedStyles.forEach(style => {
            parent.appendChild(style);
        });
    }

    async transformNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        const transformFunction = this.nodeTransformFunctons.get(node.nodeName);
        await this.rewriteAttributes(node);
        if (transformFunction) {
            await transformFunction(node, this);
            return;
        }
        return;
    }

    async transformLink(node, doc) {
        if (node.attributes.rel && node.attributes.rel.nodeValue.trim().toLowerCase() == 'stylesheet') {
            if (!node.attributes.href) {
                return;
            }
            const index = doc.styleIndex++;
            const cssHref = doc.absoluteUrl(node.attributes.href.nodeValue);
            const style = document.createElement('style');
            const cssText = await downloadFile(doc.absoluteUrl(cssHref));
            style.innerHTML = await sanitizeCSS(cssText, cssHref);
            doc.styleNodes.set(index, style);
            node.remove();
        }
        if ((node.getAttribute('rel') || '').trim().toLowerCase() == 'icon' || (node.getAttribute('rel') || '').trim().toLowerCase() == 'shortcut icon') {
            const favicon = await downloadFile(doc.absouleUrl(node.getAttribute('href')));
            document.getElementById('favicon').value = favicon;
            node.setAttribute('href', favicon);
        }
    }

    async transformStyle(node, doc) {
        const innerText = await sanitizeCSS(node.innerText, doc.url);
        node.innerText = innerText;
    }

    async transfromImg(node, doc) {
        const src = await downloadFile(doc.absoluteUrl(node.getAttribute('src')));
        node.src = src;
        if (node.getAttribute('srcset')) {
            let val = node.getAttribute('srcset');
            let newParts = [];
            for (let s of val.split(',')) {
                let srcParts = s.trim().split(' ');
                srcParts[0] = await downloadFile(doc.absoluteUrl(srcParts[0]));
                newParts.push(srcParts.join(' '));
            }
            node.setAttribute('srcset', newParts.join(', '));
        }
    }

    async transfromIframe(node, doc) {
        const src = doc.absoluteUrl(node.getAttribute('src'));
        for (let iframe of doc.iframes) {
            if (iframe.url == src) {
                await iframe.transformDom();
                const inlineSrc = `data:text/html;base64,${btoa(iframe.getDomAsText())}`;
                node.setAttribute('src', inlineSrc);
                return;
            }
        }
        console.log("Meh, iframe not found: ", iframe.src);
    }

    async setUrl(node, doc) {
        doc.url = doc.absoluteUrl(node.getAttribute('href'));
    }

    async rewriteAttributes(node) {
        const nodeAttributeArray = [...node.attributes];
        return Promise.allSettled(nodeAttributeArray.map(async (attr) => {
            if (attr.nodeName.startsWith('on') || attr.nodeValue.startsWith('javascript:')) {
                attr.nodeValue = '';
            }
            if (attr.nodeName == 'href') {
                attr.nodeValue = this.absoluteUrl(attr.nodeValue);
            }
            if (attr.nodeName == 'style') {
                const sanitizedValue = await sanitizeCSS(`a{${attr.nodeValue}}`, this.url);
                attr.nodeValue = sanitizedValue.substr(4, sanitizedValue.length - 6);
            }
        }));
    }
}

export { Document }
