import { AnyNode, Element } from 'domhandler';
import { parseDocument, DomUtils } from 'htmlparser2';
import {
  HeaderBlock,
  ImageBlock,
  Link,
  RichText,
  RichTextElement,
  RichTextList,
  RichTextPreformatted,
  RichTextQuote,
  RichTextSection,
} from '../types';
import { blockBuilder, linearizeLists } from '../utils';

/**
 * Parses HTML content and converts it to Slack blocks.
 *
 * @param {string} html - The HTML content to parse.
 */

function findDomElementsByTagName(dom: AnyNode[], tag: string) {
  return DomUtils.findAll(
    (node) => node.type === 'tag' && node.name === tag,
    dom
  );
}

function parseNode(node: AnyNode) {
  let block:
    | RichTextSection
    | RichTextList
    | RichTextPreformatted
    | RichTextQuote
    | RichTextElement
    | HeaderBlock
    | ImageBlock = {} as
    | RichTextSection
    | RichTextList
    | RichTextPreformatted
    | RichTextQuote
    | RichTextElement
    | HeaderBlock
    | ImageBlock;
  switch (node.type) {
    case 'tag': {
      switch (node.name) {
        case 'ul':
        case 'ol':
          block = {
            type: 'rich_text_list',
            style: node.name === 'ul' ? 'bullet' : 'ordered',
            elements: [],
            indent: parseInt(node.attribs['indent']),
          } as RichTextList;
          break;
        case 'li':
          block = {
            type: 'rich_text_section',
            elements: [],
          } as RichTextSection;
          break;
        case 'pre':
          block = {
            type: 'rich_text_preformatted',
            elements: [],
          } as RichTextPreformatted;
          break;
        case 'blockquote':
          block = {
            type: 'rich_text_quote',
            elements: [],
          } as RichTextQuote;
          break;
        case 'img':
          block = {
            type: 'image',
            image_url: node.attribs.src,
            alt_text: node.attribs.alt || '',
          } as ImageBlock;
          if (node.attribs.title) {
            block.title = {
              type: 'plain_text',
              text: node.attribs.title,
            };
          }
          break;
        case 'b':
        case 'strong':
        case 'i':
        case 'em':
        case 's':
        case 'del':
        case 'code':
        case 'a':
          return parseText(node);
        case 'p':
          block = {
            type: 'rich_text_section',
            elements: [],
          } as RichTextSection;
          break;
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6':
          return parseHeader(node);
        default:
          break;
      }
      if (block && node.children) {
        for (const child of node.children) {
          const childObj = parseNode(child);
          if (childObj && 'elements' in block) {
            if (!Array.isArray(childObj)) {
              (block.elements as RichTextElement[]).push(
                ...([childObj] as RichTextElement[])
              );
            } else {
              (block.elements as RichTextElement[]).push(...childObj); // Flatten the array
            }
            block.elements = (block.elements as RichTextElement[]).filter(
              (element) => Object.keys(element).length !== 0
            );
          }
        }
      }
      break;
    }
    case 'text':
      return parseText(node);
  }
  return block;
}

function parseHeader(node: Element) {
  const header: HeaderBlock = {} as HeaderBlock;
  if (
    node.children &&
    node.children[0] &&
    node.children[0].type === 'text' &&
    node.children[0].data
  ) {
    header.type = 'header';
    header.text = {
      type: 'plain_text',
      text: node.children[0].data,
    };
  }
  return header;
}
function parseText(
  node: AnyNode,
  style: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
  } = {}
) {
  const texts: (RichText | Link)[] = [];

  if (node.type === 'tag') {
    switch (node.name) {
      case 'b':
      case 'strong':
        style.bold = true;
        break;
      case 'i':
      case 'em':
        style.italic = true;
        break;
      case 's':
      case 'del':
        style.strike = true;
        break;
      case 'code':
        style.code = true;
        break;
      default:
        break;
    }
    if (node.name === 'a') {
      const textElement: Link = {
        type: 'link',
        url: node.attribs.href,
      };
      if (Object.keys(style).length > 0) {
        textElement.style = { ...style };
      }

      if (node.children) {
        if (node.children[0].type === 'text') {
          textElement.text = node.children[0].data;
        }
      }
      texts.push(textElement);
    } else {
      for (const child of node.children) {
        texts.push(...parseText(child, { ...style }));
      }
    }
  } else if (node.type === 'text') {
    const textElement: RichText = {
      type: 'text',
      text: node.data.replace(/<br ?\/?>/g, '\n').replace(/^\s*$/, ''),
    };

    if (Object.keys(style).length > 0) {
      textElement.style = { ...style };
    }

    texts.push(textElement);
  }
  return texts;
}
function compressHTML(html: string): string {
  // Use a regular expression to find content within <pre> tags and store it. SPACES
  const preTags: string[] = [];
  const preLeadingSpaces: string[] = [];

  html = html.replace(
    /([ \t]*)<pre>([\s\S]*?)<\/pre>/g,
    (match, leadingSpaces, content) => {
      preTags.push(content.replace(/^\n/, ''));
      preLeadingSpaces.push(leadingSpaces);
      return `<pre>${preTags.length - 1}</pre>`;
    }
  );

  // Use a regular expression to find tag attributes and store them.
  const tagAttributes: string[] = [];
  html = html.replace(/<(\w+)([^>]*)>/g, (match, tagName, attributes) => {
    tagAttributes.push(attributes);
    return `<${tagName} data-tag-attr="${tagAttributes.length - 1}">`;
  });

  // Remove all newlines and extra spaces from the HTML string
  html = html.replace(/\n[\n ]*/g, '');

  // Restore the original tag attributes
  html = html.replace(
    /<(\w+) data-tag-attr="(\d+)">/g,
    (match, tagName, index) => {
      return `<${tagName}${tagAttributes[parseInt(index)]}>`;
    }
  );

  // Restore the original content within <pre> tags
  html = html.replace(/<pre>(\d+)<\/pre>/g, (match, index) => {
    const content = preTags[parseInt(index)];
    const leadingSpaces = preLeadingSpaces[parseInt(index)];

    // Remove the leading spaces from each line in the content
    const adjustedContent = content.replace(
      new RegExp('^' + leadingSpaces, 'mg'),
      ''
    );

    return `<pre>${adjustedContent}</pre>`;
  });

  html = html
    .replace(/<br ?\/?>/g, '\n')
    .replace(/<\/?span[^>]*>/g, '')
    .replace(/<\/?div[^>]*>/g, '');
  // Add spaces around inline elements within <p> tags
  html = html.replace(/<p>([\s\S]*?)<\/p>/g, (match, content) => {
    // Ensure there are spaces around inline tags
    content = content.replace(/(\S)(<b>|<i>|<code>)/g, '$1 $2'); // space before tags
    return `<p>${content}</p>`;
  });
  return html;
}
export function parseHtml(html: string) {
  html = compressHTML(html);
  html = linearizeLists(html);

  const dom = parseDocument(html);
  const body = findDomElementsByTagName(dom.children, 'body')[0] || dom;
  const blocks: (
    | RichTextSection
    | RichTextList
    | RichTextPreformatted
    | RichTextQuote
    | RichTextElement
    | HeaderBlock
    | ImageBlock
  )[] = [];
  body.children.forEach((node) => {
    const tmp = parseNode(node);
    if (!Array.isArray(tmp)) {
      blocks.push(tmp);
    } else {
      const regex = /^(?!\n\s*$).*/;
      blocks.push(
        ...tmp.filter((block) => block.text && regex.test(block.text as string))
      );
    }
  });
  const blocksObj = blockBuilder(blocks);

  return blocksObj;
}
